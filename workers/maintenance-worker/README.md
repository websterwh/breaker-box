# maintenance-worker

Sits in front of your real origin. On every request it either passes the
request through untouched, or shows a maintenance / restarting / offline
page instead — controlled by a `MODE` secret that the Breaker Box plugin
flips for you.

- `MODE` unset — passes requests straight through. If the origin returns a
  5xx or the request fails, it shows a "Restarting" page for the first 15
  minutes of an outage, then an "Offline" page after that.
- `MODE=M` — always shows the "Under maintenance" page, regardless of
  origin health.
- `MODE=R` — always shows the "Restarting" page to this visitor, while
  checking the origin in the background so `MODE` clears itself once the
  origin is healthy again.

## Deploy your own copy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/websterwh/breaker-box/tree/main/workers/maintenance-worker)

After deploying, point this Worker at your real origin (Route or Custom
Domain, in the Cloudflare dashboard) and note its script name — you'll
enter that as the "Worker Script Name" in the Breaker Box plugin.

## Customizing the messages

Every message is optional and falls back to a plain default if unset. Set
any of these as a Worker secret or variable (dashboard → this Worker →
Settings → Variables and Secrets), or from the Breaker Box plugin's
Messages panel, which writes to the same names through your proxy Worker:

| Name            | Shown when             | Default                                                              |
|-----------------|-------------------------|-----------------------------------------------------------------------|
| `MAINT_TITLE`   | `MODE=M`                | Under maintenance                                                      |
| `MAINT_BODY`    | `MODE=M`                | This server is offline for scheduled maintenance. It'll be back online shortly. |
| `RESTART_TITLE` | `MODE=R` or auto-detect | Restarting                                                             |
| `RESTART_BODY`  | `MODE=R` or auto-detect | This server is restarting for a moment. It'll be back online shortly.  |
| `OFFLINE_TITLE` | down > 15 min           | Device is offline                                                      |
| `OFFLINE_BODY`  | down > 15 min           | This server has been unreachable for a while. Please contact the owner. |
| `FOOTNOTE`      | every page above        | (none)                                                                 |

## Optional: self-clearing timer

To let a "Restarting" or timed "Under maintenance" state clear itself
automatically, set these on this Worker (separate from anything the plugin
sends):

- `CF_API_TOKEN` (secret) — needs "Edit Cloudflare Workers" permission
- `CF_ACCOUNT_ID` — your Cloudflare account ID
- `CF_SCRIPT_NAME` — this Worker's script name (defaults to `maintenance-worker`)

Without these, the timer/auto-revert features are silent no-ops — manual
`M` / `R` / off still work exactly the same. Add a Cron Trigger (dashboard
→ this Worker → Triggers) so the timer is also enforced with zero
incoming traffic, e.g. every minute: `*/1 * * * *`.
