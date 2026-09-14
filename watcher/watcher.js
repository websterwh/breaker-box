#!/usr/bin/env node
// Breaker Box container watcher - runs as a background service on the MOS
// host (see breaker-box-watcher.init), independent of any browser tab.
//
// Reads the plugin's own settings straight from disk (no MOS API token
// needed) and polls Docker directly over its local socket (this process
// runs as root on the same host, so it doesn't need MOS's Docker proxy
// either). When the configured container starts restarting, it pushes a
// message override and a MODE=R secret to the Worker through its
// built-in /__bbproxy relay - the exact same secrets the plugin's manual
// buttons and Messages panel use - and reverts them once Docker reports
// the container running again.
//
// SETTINGS_PATH was found by inspecting a live MOS install
// (/boot/optional/plugins/<pluginName>/settings.json); MOS doesn't
// document this path, so a future MOS version could change it. If this
// stops finding the file, this is the first place to check.
const fs = require("fs");
const http = require("http");
const https = require("https");

const SETTINGS_PATH = "/boot/optional/plugins/breaker-box/settings.json";
const DOCKER_SOCKET = "/var/run/docker.sock";
const POLL_MS = 10000;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function readSettings() {
  const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
  return JSON.parse(raw);
}

function dockerRequest(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: DOCKER_SOCKET, path, method: "GET" },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Docker API HTTP ${res.statusCode}: ${body}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Docker API returned invalid JSON: ${e.message}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function findContainer(name) {
  const containers = await dockerRequest("/containers/json?all=true");
  return (containers || []).find(
    (c) => c.Names && c.Names.some((n) => n.replace(/^\//, "") === name)
  );
}

function relayBase(workerUrl) {
  return workerUrl.replace(/\/$/, "") + "/__bbproxy";
}

function cfRequest(cfg, method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${relayBase(cfg.workerUrl)}${path}`);
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          Authorization: `Bearer ${cfg.apiToken}`,
          ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed = {};
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch (e) {
            // Non-JSON response - fall through with an empty object, the
            // status-code check below still catches real failures.
          }
          const alreadyGone =
            res.statusCode >= 400 && /not found/i.test((parsed.errors || [])[0]?.message || "");
          if ((res.statusCode < 200 || res.statusCode >= 300 || parsed.success === false) && !alreadyGone) {
            return reject(new Error(parsed.errors?.[0]?.message || `HTTP ${res.statusCode}`));
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function scriptSecretsPath(cfg) {
  return `/client/v4/accounts/${cfg.accountId}/workers/scripts/${cfg.scriptName}/secrets`;
}

async function putSecret(cfg, name, text) {
  await cfRequest(cfg, "PUT", scriptSecretsPath(cfg), { name, text, type: "secret_text" });
}

async function deleteSecretIfPresent(cfg, name) {
  await cfRequest(cfg, "DELETE", `${scriptSecretsPath(cfg)}/${name}`);
}

function loadConfig() {
  const settings = readSettings();
  const form = settings.form || {};
  if (!form.workerUrl || !form.apiToken || !form.accountId || !form.scriptName || !form.containerName) {
    return null;
  }
  return {
    workerUrl: form.workerUrl,
    apiToken: form.apiToken,
    accountId: form.accountId,
    scriptName: form.scriptName,
    secretName: form.secretName || "MODE",
    containerName: form.containerName,
    normalRestartTitle: (settings.messagesForm && settings.messagesForm.restartTitle) || "",
  };
}

let lastDockerState = null;
let overrideActive = false;
let lastSkipReason = null;

async function beginOverride(cfg) {
  log(`"${cfg.containerName}" is restarting - overriding Worker`);
  await putSecret(cfg, "RESTART_TITLE", `${cfg.containerName} is restarting`);
  await putSecret(cfg, cfg.secretName, "R");
  await putSecret(cfg, "CONTAINER_WATCH_AT", String(Date.now()));
  overrideActive = true;
}

async function refreshOverride(cfg) {
  await putSecret(cfg, "CONTAINER_WATCH_AT", String(Date.now()));
}

async function endOverride(cfg) {
  log(`"${cfg.containerName}" is running again - reverting Worker override`);
  if (cfg.normalRestartTitle.trim()) {
    await putSecret(cfg, "RESTART_TITLE", cfg.normalRestartTitle.trim());
  } else {
    await deleteSecretIfPresent(cfg, "RESTART_TITLE");
  }
  await deleteSecretIfPresent(cfg, cfg.secretName);
  await deleteSecretIfPresent(cfg, `${cfg.secretName}_REVERT_AT`);
  await deleteSecretIfPresent(cfg, "CONTAINER_WATCH_AT");
  overrideActive = false;
}

async function tick() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    if (lastSkipReason !== "settings") {
      log(`Couldn't read settings (${e.message}) - waiting for the plugin to save valid settings`);
      lastSkipReason = "settings";
    }
    return;
  }
  if (!cfg) {
    if (lastSkipReason !== "incomplete") {
      log("Watch not configured (no container selected, or Worker settings incomplete) - idle");
      lastSkipReason = "incomplete";
    }
    return;
  }
  lastSkipReason = null;

  let container;
  try {
    container = await findContainer(cfg.containerName);
  } catch (e) {
    log(`Docker check failed: ${e.message}`);
    return;
  }
  if (!container) {
    log(`Container "${cfg.containerName}" not found`);
    return;
  }

  const state = container.State; // "running" | "restarting" | "exited" | ...
  const wasRestarting = lastDockerState === "restarting";
  lastDockerState = state;

  try {
    if (state === "restarting" && !wasRestarting) {
      await beginOverride(cfg);
    } else if (state === "restarting" && wasRestarting) {
      await refreshOverride(cfg);
    } else if (state === "running" && (wasRestarting || overrideActive)) {
      await endOverride(cfg);
    }
  } catch (e) {
    log(`Failed to update Worker: ${e.message}`);
  }
}

log("Breaker Box container watcher starting");
tick();
const timer = setInterval(tick, POLL_MS);

process.on("SIGTERM", () => {
  log("Stopping (SIGTERM)");
  clearInterval(timer);
  process.exit(0);
});
process.on("SIGINT", () => {
  log("Stopping (SIGINT)");
  clearInterval(timer);
  process.exit(0);
});
