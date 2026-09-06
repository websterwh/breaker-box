// Generic CORS-unlocking proxy for api.cloudflare.com.
//
// Why this exists: api.cloudflare.com does not send Access-Control-Allow-Origin
// headers, so a browser-based tool (like a MOS plugin) can never call it
// directly - the browser blocks the request before it even reaches Cloudflare.
// This Worker sits in between: it forwards whatever the caller sends
// (method, path, headers, body) to api.cloudflare.com untouched, then adds
// CORS headers to the response so the browser accepts it.
//
// This Worker holds no secrets of its own and is not specific to any one
// Cloudflare account, script, or use case. The caller supplies their own
// Cloudflare API token in the Authorization header (or X-Auth-Email /
// X-Auth-Key) with every request; this Worker only relays it upstream and
// never stores or logs it. Only requests to api.cloudflare.com are ever
// forwarded - it cannot be used to reach any other host.
//
// Anyone can deploy their own copy of this Worker (see README) and use it
// with any browser-based tool that needs to call the Cloudflare API.

const UPSTREAM_HOST = "api.cloudflare.com";
const UPSTREAM_ORIGIN = `https://${UPSTREAM_HOST}`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Auth-Email,X-Auth-Key",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    // Preflight - answer directly, never forward OPTIONS upstream.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Simple health check for the root path so it's easy to confirm the
    // Worker deployed correctly without needing a real Cloudflare API call.
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(
        JSON.stringify({ ok: true, proxying: UPSTREAM_ORIGIN }),
        { headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const upstreamUrl = UPSTREAM_ORIGIN + url.pathname + url.search;

    // Strip hop-specific / browser-added headers that shouldn't be forwarded
    // or that would confuse the upstream request.
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("origin");
    headers.delete("referer");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");

    const init = {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await request.arrayBuffer(),
    };

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstreamUrl, init);
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, errors: [{ message: `Proxy fetch failed: ${err.message}` }] }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      responseHeaders.set(k, v);
    }
    // Cloudflare's own Set-Cookie headers are irrelevant to the caller and
    // shouldn't leak through.
    responseHeaders.delete("set-cookie");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
