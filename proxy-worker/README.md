# proxy-worker (part of the breaker-box repo)

A tiny, generic Cloudflare Worker that unlocks browser access to the
Cloudflare API. Lives inside the `breaker-box` repo as a subdirectory since
it's only needed to support that MOS plugin, but it's fully generic and not
specific to it — anyone can deploy a copy for any tool that needs to call
the Cloudflare API from a browser.

`api.cloudflare.com` never sends `Access-Control-Allow-Origin` headers, so a
browser-based tool (a MOS plugin, a dashboard, a bookmarklet) can never call
it directly — the browser blocks the request before it reaches Cloudflare at
all. This Worker forwards whatever you send it straight through to
`api.cloudflare.com`, unchanged, and adds CORS headers to the response so
your browser accepts it.

**It holds no secrets and isn't tied to any account, script, or use case.**
You put your own Cloudflare API token in the request's `Authorization`
header, same as if you were calling `api.cloudflare.com` directly — this
Worker only relays it upstream. It never stores or logs anything. It also
only ever forwards to `api.cloudflare.com` — it can't be pointed at any other
host.

## Deploy your own copy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/websterwh/breaker-box/tree/main/proxy-worker)

Click the button, sign in to your own Cloudflare account, and follow the
prompts. Cloudflare will fork this repo into your GitHub account and deploy
the Worker for you (from just the `proxy-worker` subdirectory). Note the
Worker's URL when it's done (something like
`https://cf-api-cors-proxy.<your-subdomain>.workers.dev`) — that's the URL
you'll paste into the [Breaker Box](https://github.com/websterwh/breaker-box)
MOS plugin's settings.

## Manual deploy

```bash
git clone https://github.com/websterwh/breaker-box.git
cd breaker-box/proxy-worker
npm install
npx wrangler login
npx wrangler deploy
```

## Usage

Call it exactly like you'd call `api.cloudflare.com`, just with this
Worker's URL as the host:

```bash
curl -X GET "https://cf-api-cors-proxy.<you>.workers.dev/client/v4/accounts/<account_id>/workers/scripts/<script>/secrets" \
  -H "Authorization: Bearer <your-cf-api-token>"
```

## Security note

Anyone who knows this Worker's URL can use it to relay Cloudflare API calls
— but only with a token *they* supply. The Worker itself never has access to
your Cloudflare account. Treat the Worker's URL the same way you'd treat any
other public endpoint: nothing secret about the URL itself, all the risk
lives in whoever holds the API token.
