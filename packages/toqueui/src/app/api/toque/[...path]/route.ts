/**
 * Next.js API Proxy for Toque Backend
 * Forwards all /api/toque/* requests to the toque backend server-side,
 * bypassing browser CORS restrictions entirely.
 *
 * Usage: All toque API calls go to /api/toque/<path> instead of directly to the backend.
 *
 * Performance: response + request bodies are streamed straight through (zero buffering),
 * and safe GET endpoints are eligible for short-lived edge caching.
 */

import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_TARGET = 'https://toque.decloud.workers.dev';

// Short-lived edge cache for read-only GET endpoints (ms-equivalent TTL in seconds).
// Keeps repeat reads (health, autha reads) sub-millisecond.
const CACHEABLE_GET = new Set(['/health', '/autha/health', '/autha/entities', '/autha/stats']);
const GET_CACHE_TTL_S = 3;

function getTargetBase(req: NextRequest): string {
  // Allow override via query param ?_target=... (for custom base URL from localStorage)
  const override = req.nextUrl.searchParams.get('_target');
  if (override) return override.replace(/\/$/, '');
  return (process.env.TOQUE_BASE_URL || DEFAULT_TARGET).replace(/\/$/, '');
}

async function proxyRequest(req: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const apiPath = '/' + pathSegments.join('/');

  // Build target URL — strip _target from forwarded query string
  const targetBase = getTargetBase(req);
  const searchParams = new URLSearchParams(req.nextUrl.searchParams.toString());
  searchParams.delete('_target');
  const queryString = searchParams.toString();
  const targetUrl = `${targetBase}${apiPath}${queryString ? `?${queryString}` : ''}`;

  // Forward relevant headers, drop Next.js/host-specific ones
  const forwardHeaders: Record<string, string> = {
    'Content-Type': req.headers.get('content-type') || 'application/json',
  };

  const apiKey = req.headers.get('x-api-key');
  if (apiKey) forwardHeaders['X-API-Key'] = apiKey;

  const auth = req.headers.get('authorization');
  if (auth) forwardHeaders['Authorization'] = auth;

  const xReqWith = req.headers.get('x-requested-with');
  if (xReqWith) forwardHeaders['X-Requested-With'] = xReqWith;

  const isGet = ['GET', 'HEAD'].includes(req.method);
  const cacheable = isGet && CACHEABLE_GET.has(apiPath);

  try {
    const fetchOptions: RequestInit = {
      method: req.method,
      headers: forwardHeaders,
      // Stream the request body straight through — no buffering.
      body: isGet ? undefined : req.body,
      keepalive: true,
      // Ask Cloudflare's edge cache to serve repeat GET reads instantly.
      ...(cacheable ? { cf: { cacheEverything: true, cacheTtl: GET_CACHE_TTL_S } } : {}),
    };

    const upstream = await fetch(targetUrl, fetchOptions);

    const responseHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
    };
    if (cacheable) {
      responseHeaders['Cache-Control'] =
        `public, max-age=${GET_CACHE_TTL_S}, s-maxage=${GET_CACHE_TTL_S}`;
    } else {
      responseHeaders['Cache-Control'] = 'no-store';
    }
    const ct = upstream.headers.get('content-type');
    if (ct) responseHeaders['Content-Type'] = ct;

    // Stream the response body straight through — zero buffering.
    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Proxy fetch failed';
    return NextResponse.json({ error: 'Proxy error', message }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(req, path);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(req, path);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(req, path);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(req, path);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(req, path);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    },
  });
}
