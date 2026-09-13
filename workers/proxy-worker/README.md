# proxy-worker

A generic CORS-unlocking relay for `api.cloudflare.com`. Browsers can't call
the Cloudflare API directly — it doesn't send `Access-Control-Allow-Origin`
headers, so the browser blocks the request before it reaches Cloudflare.
This Worker forwards whatever the caller sends (method, path, headers,
body) upstream untouched, then adds CORS headers to the response.

It holds no secrets of its own and isn't tied to any account, script, or
use case — the caller supplies their own Cloudflare API token with every
request, and this Worker only relays it. It only ever forwards to
`api.cloudflare.com`.

## Deploy your own copy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/websterwh/breaker-box/tree/main/workers/proxy-worker)

Click the button, sign in to your own Cloudflare account, and follow the
prompts. You'll need this Worker's deployed URL for the Breaker Box
plugin's "Proxy Worker URL" setting.
