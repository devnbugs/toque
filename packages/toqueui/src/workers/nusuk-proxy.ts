/**
 * Cloudflare Worker — Nusuk API Edge Proxy
 * Routes requests through Cloudflare's global edge network to the Nusuk target.
 *
 * Deploy: wrangler deploy --config wrangler.proxy.toml
 * Usage:  Set NEXT_PUBLIC_PROXY_BASE_URL=https://toqueui-proxy.<subdomain>.workers.dev
 *         in your .env and use it as the base URL in the app.
 */

export interface Env {
  TARGET_BASE_URL: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const targetBase = (env.TARGET_BASE_URL || 'https://toque.decloud.workers.dev').replace(/\/$/, '');

    // Build target URL: proxy path + query string → target
    const targetUrl = `${targetBase}${url.pathname}${url.search}`;

    // Clone request headers, strip CF-specific headers
    const headers = new Headers(request.headers);
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ipcountry');
    headers.delete('cf-ray');
    headers.delete('cf-visitor');
    headers.set('X-Forwarded-Host', url.hostname);
    headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

    try {
      const proxyRequest = new Request(targetUrl, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'follow',
      });

      const response = await fetch(proxyRequest);

      // Forward response with CORS headers added
      const responseHeaders = new Headers(response.headers);
      Object.entries(CORS_HEADERS).forEach(([k, v]) => responseHeaders.set(k, v));

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err: any) {
      return new Response(
        JSON.stringify({ error: 'Proxy error', message: err?.message || 'Unknown error' }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        }
      );
    }
  },
};
