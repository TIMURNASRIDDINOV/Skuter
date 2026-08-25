/**
 * The admin panel's Worker: static assets, plus the API on the same origin.
 *
 * `/api/*` is dispatched to the API Worker through a service binding, so the
 * panel never makes a cross-origin request. That removes a class of failure
 * invisible from the server side — CORS, privacy extensions that block
 * cross-site XHR, and a resolver or network that treats the api hostname
 * differently from this one. A blocked fetch throws exactly like an
 * unreachable server, so all of those surfaced as "нет соединения" against an
 * API that was demonstrably up.
 *
 * Everything else falls through to the built SPA.
 */

interface Fetcher {
  fetch: (request: Request) => Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
  API: Fetcher;
}

/** The API is mounted here; `/api/admin/users` reaches it as `/admin/users`. */
const PREFIX = '/api';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${PREFIX}/`)) return env.ASSETS.fetch(request);

    const target = new URL(url.pathname.slice(PREFIX.length) + url.search, url.origin);

    // `host` must not be forwarded to the binding — Cloudflare routes on it,
    // and the admin's own host sent an API request straight back here.
    const headers = new Headers(request.headers);
    headers.delete('host');

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const upstream = await env.API.fetch(
      new Request(target.toString(), {
        method: request.method,
        headers,
        body: hasBody ? await request.arrayBuffer() : null,
        redirect: 'manual',
      }),
    );

    // Returned as-is so the SSE stream at /admin/events keeps streaming
    // rather than being buffered.
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    });
  },
};
