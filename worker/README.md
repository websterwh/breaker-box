# breaker-box-worker

One Worker, two jobs:

1. **Front your origin.** On every request it either passes the request
   through untouched, or shows a maintenance / restarting / offline page
   instead — controlled by a `MODE` secret that the Breaker Box plugin
   flips for you.
2. **Relay the Cloudflare API for the plugin**, mounted at `/__bbproxy/*`.
   Browsers can't call `api.cloudflare.com` directly — it doesn't send
   `Access-Control-Allow-Origin` headers, so the browser blocks the
   request before it reaches Cloudflare. The plugin calls this Worker's
   own `/__bbproxy/...` path instead, which forwards the request
   server-side (no CORS problem there) and adds CORS headers to the
   response. It holds no secrets of its own — the plugin sends its own
   Cloudflare API token with every request, and this Worker only relays
   it upstream, never stores or logs it, and only ever forwards to
   `api.cloudflare.com`.

## `MODE` behavior

- `MODE` unset — passes requests straight through. If the origin returns
  a 5xx or the request fails, it shows a "Restarting" page for the first
  15 minutes of an outage, then an "Offline" page after that - unless
  `AUTO_FEATURES_ENABLED` is `"0"` (see below), in which case it just
  passes the request straight through with no interception at all.
- `MODE=M` — always shows the "Under maintenance" page, regardless of
  origin health.
- `MODE=R` — always shows the "Restarting" page to this visitor, while
  checking the origin in the background so `MODE` clears itself once the
  origin is healthy again.

`AUTO_FEATURES_ENABLED` (optional, set by the plugin's global "Auto
features on" switch): `"0"` turns off every piece of automatic behavior
at once - this Worker's own auto-detect fallback above (with no `MODE`
set, requests pass straight through, exactly as if this Worker weren't
here on a real outage), plus the background container watcher (see
[watcher/](../watcher)) and auto-pushing Worker code on plugin updates.
Manually setting `MODE=M`/`MODE=R` still always works either way - this
only affects what happens automatically.

## Deploy your own copy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/websterwh/breaker-box/tree/main/worker)

After deploying, point this Worker at your real origin (Route or Custom
Domain, in the Cloudflare dashboard) and note its script name and its
`*.workers.dev` (or custom) URL — you'll enter both in the Breaker Box
plugin's settings.

## Customizing the messages

Every message is optional and falls back to a plain default if unset. Set
any of these as a Worker secret or variable (dashboard → this Worker →
Settings → Variables and Secrets), or from the Breaker Box plugin's
Messages panel, which writes to the same names through this Worker's
built-in relay:

| Name            | Shown when             | Default                                                              |
|-----------------|-------------------------|-----------------------------------------------------------------------|
| `MAINT_TITLE`   | `MODE=M`                | Under maintenance                                                      |
| `MAINT_BODY`    | `MODE=M`                | This server is offline for scheduled maintenance. It'll be back online shortly. |
| `RESTART_TITLE` | `MODE=R` or auto-detect | Restarting                                                             |
| `RESTART_BODY`  | `MODE=R` or auto-detect | This server is restarting for a moment. It'll be back online shortly.  |
| `OFFLINE_TITLE` | down > 15 min\*         | Device is offline                                                      |
| `OFFLINE_BODY`  | down > 15 min\*         | This server has been unreachable for a while. Please contact the owner. |

\* extended automatically while a live container-watch signal confirms it's still genuinely restarting — see below.
| `FOOTNOTE`      | every page above        | (none)                                                                 |

## Updating this Worker's code from the plugin

The plugin's Settings panel has an "Update Worker Code" action that
pushes the latest bundled copy of this file to your deployed Worker, so
you don't have to manually copy/paste code into the dashboard every time
the plugin updates. It leaves your existing secrets (`MODE`, message
overrides, etc.) alone entirely - Cloudflare's API never returns a
secret's actual value once set, so there's nothing for this action to
read back or re-submit for those; it only re-submits non-secret bindings
(if you have any) and otherwise omits `bindings` from the request, which
is what makes Cloudflare keep what's already bound. Confirm with
"Refresh status" afterward the first time you use it.

"Automatically push new code when this plugin updates" (checked by
default, next to the button) runs this same action on its own whenever
the plugin loads with connection settings filled in and this build's
bundled Worker code differs from whatever was last actually pushed -
tracked by a lightweight hash, not re-pushed on every ordinary page
load. Uncheck it to only push manually.

## Optional: live container-aware restart detection

[`watcher/`](../watcher) - a small background service installed
alongside the plugin, running on your MOS host independent of any
browser tab - polls every container on the host every ~10 seconds (this
Worker runs on Cloudflare's edge and has no way to reach your LAN's
Docker socket on its own, which is why this piece runs locally instead).
Optionally restrict it to one container via the plugin's Settings. When
it sees a container actually restarting, it pushes `RESTART_TITLE` with
the real container name(s) and a `CONTAINER_WATCH_AT` timestamp to this
Worker; while
that timestamp stays fresh (refreshed every poll while still restarting),
this Worker keeps showing "Restarting" instead of switching to "Offline"
after 15 minutes, since a live signal is confirming the restart is still
genuinely happening. Once the container's confirmed running again,
everything reverts to your normal messages and the ordinary elapsed-time
behavior above.

## Optional: self-clearing timer

To let a "Restarting" or timed "Under maintenance" state clear itself
automatically, set these on this Worker (separate from anything the
plugin sends):

- `CF_API_TOKEN` (secret) — needs "Edit Cloudflare Workers" permission
- `CF_ACCOUNT_ID` — your Cloudflare account ID
- `CF_SCRIPT_NAME` — this Worker's script name (defaults to `breaker-box-worker`)

Without these, the timer/auto-revert features are silent no-ops — manual
`M` / `R` / off still work exactly the same. Add a Cron Trigger (dashboard
→ this Worker → Triggers) so the timer is also enforced with zero
incoming traffic, e.g. every minute: `*/1 * * * *`.
