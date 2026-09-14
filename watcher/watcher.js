#!/usr/bin/env node
// Breaker Box container watcher - runs as a background service on the MOS
// host (see breaker-box-watcher.init), independent of any browser tab.
//
// Reads the plugin's own settings straight from disk (no MOS API token
// needed) and polls Docker directly over its local socket (this process
// runs as root on the same host, so it doesn't need MOS's Docker proxy
// either). When a container goes from "running" to anything else, it
// pushes a message override and a MODE=R secret to the Worker through
// its built-in /__bbproxy relay - the exact same secrets the plugin's
// manual buttons and Messages panel use - and reverts them once Docker
// reports the container running again. See the transition-tracking
// comment further down for why this doesn't just match Docker's literal
// "restarting" state string.
//
// SETTINGS_PATH was found by inspecting a live MOS install
// (/boot/optional/plugins/<pluginName>/settings.json); MOS doesn't
// document this path, so a future MOS version could change it. If this
// stops finding the file, this is the first place to check.
const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");

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
// Includes each container's host-published TCP ports (if any), which is
// what readiness-checking below uses to know when it's actually back,
// rather than just "the process started".
async function currentStates(filterName) {
  const containers = await dockerRequest("/containers/json?all=true");
  const states = new Map();
  for (const c of containers || []) {
    const name = containerName(c);
    if (!name || (filterName && name !== filterName)) continue;
    const ports = (c.Ports || [])
      .filter((p) => p.Type === "tcp" && p.PublicPort)
      .map((p) => p.PublicPort);
    states.set(name, { state: c.State, ports });
  }
  return states;
}

// Tries to open a plain TCP connection to a published port on this same
// host. Succeeding means *something* is listening and accepting
// connections there - a real readiness signal, unlike Docker's "running"
// state, which only means the process started. Doesn't need to know
// anything about the service (HTTP, or otherwise) inside the container.
function checkPortOpen(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port, timeout: timeoutMs });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

// true/false once we can actually tell; null when there's no published
// port to check at all (an internal-network-only container, say) - the
// caller falls back to a plain grace period only in that case, since
// there's no better signal available.
async function isContainerReachable(ports) {
  if (!ports || ports.length === 0) return null;
  for (const port of ports) {
    if (await checkPortOpen(port)) return true;
  }
  return false;
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

// Returns null if the connection settings are incomplete, otherwise a
// config object with `disabled` reflecting the plugin's global "Auto
// features" switch - still returned with real values even when
// disabled, so a restart that was already in progress when the switch
// gets flipped off can still be cleanly reverted instead of abandoned
// mid-override.
function loadConfig() {
  const settings = readSettings();
  const form = settings.form || {};
  if (!form.workerUrl || !form.apiToken || !form.accountId || !form.scriptName) {
    return null;
  }
  return {
    disabled: form.autoFeaturesEnabled === false,
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
// Per-container tracking. Docker's literal "restarting" state string only
// applies when a restart POLICY is auto-recovering a crashed container -
// a manual restart (the MOS "Restart" button, `docker restart`, etc.)
// just stops and starts it directly, often never reporting "restarting"
// at all. So instead of matching that one string, this tracks the last
// seen state per container and treats ANY transition away from "running"
// as the start of a restart, regardless of what Docker calls the state
// in between. previousStates seeds on first sight without triggering, so
// a container that's already stopped when this service starts is never
// mistaken for "just started restarting".
const previousStates = new Map(); // name -> last observed state
const activeRestarts = new Map(); // name -> { startedAt, ports, runningSince }
// Give up treating something as "still restarting" after this long and
// let the Worker's own elapsed-time Offline behavior take back over -
// otherwise a container that's actually just stopped for good would show
// "restarting" forever.
const MAX_RESTART_WAIT_MS = 20 * 60 * 1000;
// Docker reporting "running" means the container process started, not
// that whatever's inside is actually ready to serve requests yet - a web
// app can easily still be initializing for a few seconds after that.
// Reverting the moment Docker says "running" pulls the custom message
// out from under a container that isn't really ready yet, right when a
// real request is most likely to hit it and fall through to the
// Worker's normal (generic) fallback. So this actually checks
// reachability (see isContainerReachable) rather than guessing - the
// fixed grace period below only applies as a fallback, for a container
// with no host-published port to check at all.
const REVERT_GRACE_MS = 8000;
// How often to retry the port check while waiting for a container to
// actually start accepting connections.
const READY_CHECK_MS = 1000;

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

// Guards against overlapping runs when several Docker events arrive in
// quick succession - an overlapping call would just re-read the same
// container list anyway, so skipping it loses nothing, and it avoids two
// concurrent runs racing on the shared Maps below.
let tickInFlight = false;

async function tick() {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    await tickImpl();
  } finally {
    tickInFlight = false;
  }
}

async function tickImpl() {
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
  if (cfg && cfg.disabled) {
    if (overrideActive) {
      // Got switched off mid-restart - clean up rather than leaving MODE
      // stuck on R indefinitely.
      try {
        await endOverride(cfg);
      } catch (e) {
        log(`Failed to revert Worker before going idle: ${e.message}`);
      }
      activeRestarts.clear();
      previousStates.clear();
    }
    if (lastSkipReason !== "disabled") {
      log('"Auto features" is turned off in the plugin - idle');
      lastSkipReason = "disabled";
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

  let states;
  try {
    states = await currentStates(cfg.filterName);
  } catch (e) {
    log(`Docker check failed: ${e.message}`);
    return;
  }

  const now = Date.now();
  for (const [name, info] of states) {
    const state = info.state;
    const prev = previousStates.get(name);
    if (prev === "running" && state !== "running" && !activeRestarts.has(name)) {
      activeRestarts.set(name, { startedAt: now, ports: info.ports, runningSince: null });
      log(`"${name}" stopped running (now "${state}") - treating as a restart`);
    } else if (activeRestarts.has(name)) {
      const entry = activeRestarts.get(name);
      entry.ports = info.ports; // keep current in case published ports changed
      if (state === "running") {
        if (entry.runningSince === null) entry.runningSince = now;
      } else {
        entry.runningSince = null; // flapped back down - still an active restart
      }
    }
    previousStates.set(name, state);
  }

  // Decide which active restarts are actually over now. A container with
  // published ports is only considered done once one of them actually
  // accepts a connection - not merely once Docker reports "running".
  // Without any published port to check, fall back to the fixed grace
  // period once "running" has held for that long.
  for (const [name, entry] of activeRestarts) {
    const info = states.get(name);
    if (!info) {
      activeRestarts.delete(name); // container removed - stop tracking it
      continue;
    }
    if (entry.runningSince !== null) {
      const reachable = await isContainerReachable(entry.ports);
      if (reachable === true) {
        activeRestarts.delete(name);
        continue;
      }
      if (reachable === null && now - entry.runningSince >= REVERT_GRACE_MS) {
        activeRestarts.delete(name);
        continue;
      }
      // Still waiting - make sure we come back and check again soon,
      // rather than only on the next event or the 10s poll.
      setTimeout(tick, READY_CHECK_MS);
    }
    if (now - entry.startedAt > MAX_RESTART_WAIT_MS) {
      log(`"${name}" has been down for over ${MAX_RESTART_WAIT_MS / 60000} min - giving up, falling back to the Worker's normal Offline handling`);
      activeRestarts.delete(name);
    }
  }

  const restartingNames = [...activeRestarts.keys()];
  try {
    if (restartingNames.length > 0) {
      await updateOverride(cfg, restartingNames);
    } else if (overrideActive) {
      await endOverride(cfg);
    }
  } catch (e) {
    log(`Failed to update Worker: ${e.message}`);
  }
}

// Docker's own event stream, not just the periodic tick() below: a
// container can go running -> exited -> running entirely between two
// polls on a fast restart, and polling would just see "running" both
// times and miss it completely. Subscribing to Docker's /events endpoint
// reacts the instant a container actually stops or starts, with no
// sampling gap. tick() (the periodic timer, kept as a safety net for
// missed/reconnecting events and to keep CONTAINER_WATCH_AT fresh) does
// the same work either way, so this just calls it early on the events
// that matter.
function watchDockerEvents() {
  const filters = encodeURIComponent(JSON.stringify({ type: ["container"], event: ["start", "die"] }));
  const req = http.request(
    { socketPath: DOCKER_SOCKET, path: `/events?filters=${filters}`, method: "GET" },
    (res) => {
      log("Connected to Docker's event stream");
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line) tick();
        }
      });
      res.on("end", () => {
        log("Docker event stream ended - reconnecting in 5s");
        setTimeout(watchDockerEvents, 5000);
      });
      res.on("error", (e) => {
        log(`Docker event stream error (${e.message}) - reconnecting in 5s`);
        setTimeout(watchDockerEvents, 5000);
      });
    }
  );
  req.on("error", (e) => {
    log(`Couldn't connect to Docker's event stream (${e.message}) - retrying in 5s. Falls back to the ${POLL_MS / 1000}s poll in the meantime.`);
    setTimeout(watchDockerEvents, 5000);
  });
  req.end();
}

log("Breaker Box container watcher starting");
tick();
watchDockerEvents();
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
