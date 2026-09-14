# Breaker Box (MOS plugin)

A MOS plugin that flips a Cloudflare Worker's `MODE` secret from buttons in
the MOS web UI — e.g. force an "Under maintenance" page, force a
"Restarting" page during a planned reboot, or clear it back to normal
auto-detect. The message shown on each page is editable too, either from
the plugin or straight from the Cloudflare dashboard.

Everything lives in this one repo, so forking it is enough to get the
plugin and the one Worker it depends on:

- **[`page/`](./page)** — the plugin itself (Vue), installed into MOS.
- **[`worker/`](./worker)** — sits in front of your real origin, reads
  the `MODE` secret, serves the maintenance / restarting / offline page,
  and relays the plugin's Cloudflare API calls (since browsers can't call
  `api.cloudflare.com` directly). One Worker, one deploy.
- **[`watcher/`](./watcher)** — a small background service the plugin's
  package installs on your MOS host, for the optional container-aware
  restart detection below. Runs independently of any browser tab.

## Setup

1. **Deploy `worker/`** in front of whatever origin you want to protect
   — see [its README](./worker) for the one-click deploy button and
   message customization options.
2. Install this plugin via the MOS Hub (see the parent Hub repo's README
   for adding a Hub repository).
3. Open the plugin and click the settings icon. Fill in:
   - **Worker URL** — your deployed Worker's URL
   - **Cloudflare API Token** — needs "Edit Cloudflare Workers" permission
     for the account/script you're targeting
   - **Account ID** — your Cloudflare account ID
   - **Worker Script Name** — your deployed Worker's script name
   - **Secret Name** — defaults to `MODE`
4. Save. The plugin checks whether the secret is currently set (the "last
   set" line only reflects changes made from this plugin).
5. Use the buttons to set the secret to `M`, `R`, or clear it. Optionally
   open the Messages panel to customize the title/body text shown on each
   page — see [worker](./worker#customizing-the-messages)
   for the full list and defaults.
6. If you update the plugin later and the Worker's code has also changed,
   use Settings → **Update Worker Code** to push the new bundled code to
   your Worker without copy/pasting it by hand — see
   [worker](./worker#updating-this-workers-code-from-the-plugin).
7. Optionally pick a **Container to watch** in Settings so a real Docker
   restart shows the container's own name instead of a generic message.
   This is handled by a small background service
   ([`watcher/`](./watcher)) the plugin's package installs and runs on
   your MOS host, independent of any browser tab — see
   [worker](./worker#optional-live-container-aware-restart-detection).

## Fork this repo

The Worker deploys with a one-click "Deploy to Cloudflare" button (see its
README), which forks this repo into your own GitHub account and deploys
for you. No extra repos needed.
