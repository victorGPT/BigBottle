// Supabase Edge Function: API gateway for the BigBottle MVP.
// Runtime: Deno (Supabase Edge Functions).
//
// Routes are designed to mirror the local Fastify API under `apps/api`.
//
// Expected public base URL:
//   https://<project>.supabase.co/functions/v1/api

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

type Json =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

type HttpHandler = (req: Request, ctx: { routePath: string }) => Promise<Response>;

type AppConfig = {
  CORS_ORIGIN: string;
};

function envString(name: string): string | undefined {
  const v = Deno.env.get(name);
  const trimmed = typeof v === 'string' ? v.trim() : '';
  return trimmed ? trimmed : undefined;
}

function loadConfig(): AppConfig {
  return {
    CORS_ORIGIN: envString('CORS_ORIGIN') ?? '*'
  };
}

function getRoutePath(pathname: string): string {
  // Supabase typically calls the function at:
  //   /functions/v1/<name>/<subpath?>
  // but we keep this robust for local proxies and future changes.
  const prefixes = ['/functions/v1/api', '/api'];
  for (const p of prefixes) {
    if (pathname === p) return '/';
    if (pathname.startsWith(`${p}/`)) return pathname.slice(p.length);
  }
  return pathname;
}

function corsHeaders(config: AppConfig, req: Request): Headers {
  const h = new Headers();
  const reqOrigin = req.headers.get('origin') ?? '';

  if (config.CORS_ORIGIN === '*' || !config.CORS_ORIGIN) {
    h.set('access-control-allow-origin', '*');
  } else {
    // Keep it simple for MVP: single allowed origin.
    h.set('access-control-allow-origin', config.CORS_ORIGIN);
    if (reqOrigin && reqOrigin !== config.CORS_ORIGIN) {
      // Still respond with the configured origin, but flag it for debugging.
      h.set('x-cors-origin-mismatch', reqOrigin);
    }
  }

  h.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  h.set('access-control-allow-headers', 'authorization,content-type,accept');
  h.set('access-control-max-age', '86400');
  return h;
}

function jsonResponse(config: AppConfig, req: Request, status: number, body: Json): Response {
  const headers = corsHeaders(config, req);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(config: AppConfig, req: Request, status: number, error: string): Response {
  return jsonResponse(config, req, status, { error });
}

const handleRequest: (config: AppConfig) => HttpHandler =
  (config) => async (req, ctx) => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(config, req) });
    }

    if (req.method === 'GET' && ctx.routePath === '/health') {
      return jsonResponse(config, req, 200, { ok: true });
    }

    return errorResponse(config, req, 404, 'not_found');
  };

const config = loadConfig();
const handler = handleRequest(config);

serve(async (req) => {
  const url = new URL(req.url);
  const routePath = getRoutePath(url.pathname);
  try {
    return await handler(req, { routePath });
  } catch (err) {
    console.error('unhandled_error', err);
    return errorResponse(config, req, 500, 'internal_error');
  }
});

