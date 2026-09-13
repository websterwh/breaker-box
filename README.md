# Breaker Box (MOS plugin)

A MOS plugin that flips a Cloudflare Worker's `MODE` secret from buttons in
the MOS web UI — e.g. force an "Under maintenance" page, force a
"Restarting" page during a planned reboot, or clear it back to normal
auto-detect. The message shown on each page is editable too, either from
the plugin or straight from the Cloudflare dashboard.

Everything lives in this one repo, so forking it is enough to get the
plugin and both Workers it depends on:

- **[`page/`](./page)** — the plugin itself (Vue), installed into MOS.
- **[`workers/maintenance-worker/`](./workers/maintenance-worker)** — sits
  in front of your real origin, reads the `MODE` secret, and serves the
  maintenance / restarting / offline page.
- **[`workers/proxy-worker/`](./workers/proxy-worker)** — a generic CORS
  relay the plugin talks to, since browsers can't call the Cloudflare API
  directly.

## Why the proxy Worker exists

`api.cloudflare.com` doesn't send CORS headers, so any browser blocks a
direct request. The plugin talks to your own copy of `proxy-worker`
instead, which makes the actual Cloudflare API call server-side (no CORS
problem there) and hands the result back with CORS headers attached.

## Setup

1. **Deploy `workers/maintenance-worker`** in front of whatever origin you
   want to protect — see [its README](./workers/maintenance-worker) for
   the one-click deploy button and message customization options.
2. **Deploy `workers/proxy-worker`** — see [its README](./workers/proxy-worker).
3. Install this plugin via the MOS Hub (see the parent Hub repo's README
   for adding a Hub repository).
4. Open the plugin and click the settings icon. Fill in:
   - **Proxy Worker URL** — your deployed `proxy-worker` URL
   - **Cloudflare API Token** — needs "Edit Cloudflare Workers" permission
     for the account/script you're targeting
   - **Account ID** — your Cloudflare account ID
   - **Worker Script Name** — your deployed `maintenance-worker`'s script name
   - **Secret Name** — defaults to `MODE`
5. Save. The plugin checks whether the secret is currently set (the "last
   set" line only reflects changes made from this plugin).
6. Use the buttons to set the secret to `M`, `R`, or clear it. Optionally
   open the Messages panel to customize the title/body text shown on each
   page — see [workers/maintenance-worker](./workers/maintenance-worker#customizing-the-messages)
   for the full list and defaults.

## Fork this repo

Both Workers deploy with a one-click "Deploy to Cloudflare" button (see
their READMEs), which forks this repo into your own GitHub account and
deploys for you. No extra repos needed.
