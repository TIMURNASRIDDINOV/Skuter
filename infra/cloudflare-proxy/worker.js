/**
 * Stable public front for the demo API.
 *
 * The API runs on a dev machine behind a Cloudflare quick tunnel whose
 * hostname rotates on every restart. This Worker gives the mobile app one
 * permanent URL: it forwards every request (including the admin SSE stream)
 * to the current tunnel origin, which `scripts/demo-tunnel.sh` injects as
 * the ORIGIN_URL var on each deploy.
 */
export default {
  async fetch(request, env) {
    if (!env.ORIGIN_URL) {
      return new Response('proxy: ORIGIN_URL not set — run scripts/demo-tunnel.sh', {
        status: 503,
      });
    }
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, env.ORIGIN_URL);
    const headers = new Headers(request.headers);
    headers.delete('host');
    return fetch(target, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    });
  },
};
