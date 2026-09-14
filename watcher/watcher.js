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

function containerName(c) {
  return c.Names && c.Names[0] ? c.Names[0].replace(/^\//, "") : null;
}

// No filter -> every container on the box. With a filter set (the
// plugin's optional "Container to watch" dropdown), only that one.
async function restartingContainerNames(filterName) {
  const containers = await dockerRequest("/containers/json?all=true");
  return (containers || [])
    .filter((c) => c.State === "restarting")
    .map(containerName)
    .filter((name) => name && (!filterName || name === filterName));
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
  if (!form.workerUrl || !form.apiToken || !form.accountId || !form.scriptName) {
    return null;
  }
  return {
    workerUrl: form.workerUrl,
    apiToken: form.apiToken,
    accountId: form.accountId,
    scriptName: form.scriptName,
    secretName: form.secretName || "MODE",
    // Optional: if set, only this one container is watched. Left blank
    // (the common case), every container on the box is watched.
    filterName: form.containerName || null,
    normalRestartTitle: (settings.messagesForm && settings.messagesForm.restartTitle) || "",
  };
}

let overrideActive = false;
let lastPushedTitle = null;
let lastSkipReason = null;

function titleFor(names) {
  return names.length === 1 ? `${names[0]} is restarting` : `${names.join(", ")} are restarting`;
}

// Called every tick while at least one container is restarting. Only
// re-pushes RESTART_TITLE/MODE when the set of restarting containers
// actually changed, since those rarely change tick to tick - but
// CONTAINER_WATCH_AT always refreshes, since that's what tells the
// Worker this is still a live, current signal (see worker/README.md).
async function updateOverride(cfg, names) {
  const title = titleFor(names);
  if (title !== lastPushedTitle) {
    log(`Restarting: ${names.join(", ")} - overriding Worker`);
    await putSecret(cfg, "RESTART_TITLE", title);
    await putSecret(cfg, cfg.secretName, "R");
    lastPushedTitle = title;
  }
  await putSecret(cfg, "CONTAINER_WATCH_AT", String(Date.now()));
  overrideActive = true;
}

async function endOverride(cfg) {
  log("No containers restarting - reverting Worker override");
  if (cfg.normalRestartTitle.trim()) {
    await putSecret(cfg, "RESTART_TITLE", cfg.normalRestartTitle.trim());
  } else {
    await deleteSecretIfPresent(cfg, "RESTART_TITLE");
  }
  await deleteSecretIfPresent(cfg, cfg.secretName);
  await deleteSecretIfPresent(cfg, `${cfg.secretName}_REVERT_AT`);
  await deleteSecretIfPresent(cfg, "CONTAINER_WATCH_AT");
  overrideActive = false;
  lastPushedTitle = null;
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
      log("Watch not configured (Worker settings incomplete) - idle");
      lastSkipReason = "incomplete";
    }
    return;
  }
  lastSkipReason = null;

  let restarting;
  try {
    restarting = await restartingContainerNames(cfg.filterName);
  } catch (e) {
    log(`Docker check failed: ${e.message}`);
    return;
  }

  try {
    if (restarting.length > 0) {
      await updateOverride(cfg, restarting);
    } else if (overrideActive) {
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
