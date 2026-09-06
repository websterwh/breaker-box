# Breaker Box (MOS plugin)

A MOS plugin that flips a Cloudflare Worker "MODE" secret from buttons in
the MOS web UI e.g. force an "Under maintenance" page, force a
"Restarting" page during a planned reboot, or clear it back to normal
auto-detect.

Works with any Cloudflare Worker that reads a `MODE` secret (or any secret
name you configure)

## Why this needs an extra piece

Browsers can't call the Cloudflare API directly — `api.cloudflare.com`
doesn't send CORS headers, so any browser blocks the request outright. This
plugin talks to your own copy of a small proxy Worker instead, which does
the actual Cloudflare API call server-side (no CORS problem there) and
hands the result back with CORS headers attached.

**Before setting up this plugin, deploy your own copy of the
[proxy-worker](./proxy-worker)** — one click via its Deploy to Cloudflare
button (see `proxy-worker/README.md`). You'll need that Worker's URL for
step 2 below.

## Setup

1. Install this plugin via the MOS Hub (see the parent Hub repo's README for
   adding a Hub repository).
2. Open the plugin and click the ⚙ settings icon. Fill in:
   - **Proxy Worker URL** — your deployed `cf-api-cors-proxy` URL
   - **Cloudflare API Token** — needs "Edit Cloudflare Workers" permission
     for the account/script you're targeting
   - **Account ID** — your Cloudflare account ID
   - **Worker Script Name** — the Worker whose secret you're toggling
   - **Secret Name** — defaults to `MODE`
3. Save. The plugin checks whether the secret is currently set (Cloudflare's
   API can only report whether a secret exists, never its value — the "last
   set" line only reflects changes made from this plugin).
4. Use the buttons to set the secret to `M`, `R`, or clear it.
