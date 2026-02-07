// Supabase Edge Function: API gateway for the BigBottle MVP.
// Runtime: Deno (Supabase Edge Functions).
//
// Routes are designed to mirror the local Fastify API under `apps/api`.
//
// Expected public base URL:
//   https://<project>.supabase.co/functions/v1/api

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4?target=deno';
import { SignJWT, jwtVerify } from 'https://esm.sh/jose@5.2.4?target=deno';
import { getAddress, verifyTypedData } from 'https://esm.sh/ethers@6.15.0?target=deno';

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
  JWT_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

function envString(name: string): string | undefined {
  const v = Deno.env.get(name);
  const trimmed = typeof v === 'string' ? v.trim() : '';
  return trimmed ? trimmed : undefined;
}

function loadConfig(): AppConfig {
  const JWT_SECRET = envString('JWT_SECRET');
  const SUPABASE_URL = envString('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = envString('SUPABASE_SERVICE_ROLE_KEY');

  const missing: string[] = [];
  if (!JWT_SECRET) missing.push('JWT_SECRET');
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  return {
    CORS_ORIGIN: envString('CORS_ORIGIN') ?? '*',
    JWT_SECRET,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseUuid(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim();
  if (!v) return null;
  // Strict UUID v4-ish validation is unnecessary here; keep it simple but safe.
  if (!/^[0-9a-fA-F-]{36}$/.test(v)) return null;
  return v;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
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

type DbUser = {
  id: string;
  wallet_address: string;
  created_at: string;
};

type DbAuthChallenge = {
  id: string;
  wallet_address: string;
  nonce: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

function ensureOk<T>(res: { data: T; error: unknown | null }, message: string): T {
  if (res.error) {
    const errText = typeof res.error === 'object' ? JSON.stringify(res.error) : String(res.error);
    throw new Error(`${message}: ${errText}`);
  }
  return res.data;
}

function createSupabaseAdmin(config: AppConfig): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function createRepo(supabase: SupabaseClient) {
  return {
    async getOrCreateUser(walletAddressLower: string): Promise<DbUser> {
      const upsertRes = await supabase
        .from('users')
        .upsert({ wallet_address: walletAddressLower }, { onConflict: 'wallet_address' })
        .select('*')
        .single();

      return ensureOk(upsertRes, 'Failed to upsert user') as DbUser;
    },

    async createAuthChallenge(input: {
      id: string;
      wallet_address: string;
      nonce: string;
      expires_at: string;
    }): Promise<DbAuthChallenge> {
      const res = await supabase.from('auth_challenges').insert(input).select('*').single();
      return ensureOk(res, 'Failed to create auth challenge') as DbAuthChallenge;
    },

    async getAuthChallenge(id: string): Promise<DbAuthChallenge | null> {
      const res = await supabase.from('auth_challenges').select('*').eq('id', id).maybeSingle();
      const data = ensureOk(res, 'Failed to fetch auth challenge');
      return (data as DbAuthChallenge) ?? null;
    },

    async markAuthChallengeUsed(id: string): Promise<boolean> {
      const res = await supabase
        .from('auth_challenges')
        .update({ used_at: new Date().toISOString() })
        .eq('id', id)
        .is('used_at', null)
        .select('id')
        .maybeSingle();
      const data = ensureOk(res, 'Failed to mark auth challenge used');
      return data !== null;
    }
  };
}

const LOGIN_DOMAIN = Object.freeze({
  name: 'BigBottle',
  version: '1',
  chainId: 1
});

const LOGIN_TYPES = Object.freeze({
  Login: [
    { name: 'challengeId', type: 'string' },
    { name: 'wallet', type: 'address' },
    { name: 'nonce', type: 'string' }
  ]
});

function buildLoginTypedData(params: { walletAddress: string; challengeId: string; nonce: string }) {
  const wallet = getAddress(params.walletAddress);
  return {
    domain: LOGIN_DOMAIN,
    types: LOGIN_TYPES,
    value: {
      challengeId: params.challengeId,
      wallet,
      nonce: params.nonce
    }
  } as const;
}

function verifyLoginSignature(params: {
  walletAddress: string;
  challengeId: string;
  nonce: string;
  signature: string;
}): boolean {
  const wallet = getAddress(params.walletAddress);
  const typedData = buildLoginTypedData({
    walletAddress: wallet,
    challengeId: params.challengeId,
    nonce: params.nonce
  });
  const recovered = verifyTypedData(typedData.domain, typedData.types, typedData.value, params.signature);
  return getAddress(recovered) === wallet;
}

async function readJson(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function normalizeWalletAddress(input: string): { checksum: string; lower: string } | null {
  try {
    const checksum = getAddress(input.trim());
    return { checksum, lower: checksum.toLowerCase() };
  } catch {
    return null;
  }
}

type AuthedUser = { sub: string; wallet: string };

function jwtKey(config: AppConfig): Uint8Array {
  return new TextEncoder().encode(config.JWT_SECRET);
}

async function signAccessToken(config: AppConfig, user: AuthedUser): Promise<string> {
  return await new SignJWT({ wallet: user.wallet })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .setSubject(user.sub)
    .sign(jwtKey(config));
}

async function verifyAccessToken(config: AppConfig, token: string): Promise<AuthedUser | null> {
  try {
    const { payload } = await jwtVerify(token, jwtKey(config), { algorithms: ['HS256'] });
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const wallet = typeof (payload as any).wallet === 'string' ? String((payload as any).wallet) : '';
    if (!sub || !wallet) return null;
    return { sub, wallet };
  } catch {
    return null;
  }
}

async function requireAuth(config: AppConfig, req: Request): Promise<AuthedUser | null> {
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return await verifyAccessToken(config, m[1] ?? '');
}

const handleRequest: (config: AppConfig) => HttpHandler =
  (config) => async (req, ctx) => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(config, req) });
    }

    if (req.method === 'GET' && ctx.routePath === '/health') {
      return jsonResponse(config, req, 200, { ok: true });
    }

    const supabase = createSupabaseAdmin(config);
    const repo = createRepo(supabase);

    // --- Auth ---
    if (req.method === 'POST' && ctx.routePath === '/auth/challenge') {
      const body = await readJson(req);
      if (!isRecord(body)) return errorResponse(config, req, 400, 'invalid_body');
      const address = typeof body.address === 'string' ? body.address : '';
      if (!address) return errorResponse(config, req, 400, 'invalid_body');

      const wallet = normalizeWalletAddress(address);
      if (!wallet) return errorResponse(config, req, 400, 'invalid_address');

      const challengeId = crypto.randomUUID();
      const nonce = randomHex(16);
      const expiresAtIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      await repo.createAuthChallenge({
        id: challengeId,
        wallet_address: wallet.lower,
        nonce,
        expires_at: expiresAtIso
      });

      const typedData = buildLoginTypedData({
        walletAddress: wallet.lower,
        challengeId,
        nonce
      });

      return jsonResponse(config, req, 200, {
        challenge_id: challengeId,
        typed_data: typedData
      });
    }

    if (req.method === 'POST' && ctx.routePath === '/auth/verify') {
      const body = await readJson(req);
      if (!isRecord(body)) return errorResponse(config, req, 400, 'invalid_body');
      const challengeId = parseUuid(body.challenge_id);
      const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
      if (!challengeId || !signature) return errorResponse(config, req, 400, 'invalid_body');

      const challenge = await repo.getAuthChallenge(challengeId);
      if (!challenge) return errorResponse(config, req, 401, 'invalid_challenge');
      if (challenge.used_at) return errorResponse(config, req, 401, 'challenge_used');
      if (Date.parse(challenge.expires_at) <= Date.now()) return errorResponse(config, req, 401, 'challenge_expired');

      const ok = verifyLoginSignature({
        walletAddress: challenge.wallet_address,
        challengeId: challenge.id,
        nonce: challenge.nonce,
        signature
      });
      if (!ok) return errorResponse(config, req, 401, 'invalid_signature');

      const claimed = await repo.markAuthChallengeUsed(challenge.id);
      if (!claimed) return errorResponse(config, req, 401, 'challenge_used');

      const user = await repo.getOrCreateUser(challenge.wallet_address);
      const token = await signAccessToken(config, { sub: user.id, wallet: user.wallet_address });

      return jsonResponse(config, req, 200, {
        access_token: token,
        user: { id: user.id, wallet_address: user.wallet_address, created_at: user.created_at }
      });
    }

    if (req.method === 'GET' && ctx.routePath === '/me') {
      const authed = await requireAuth(config, req);
      if (!authed) return errorResponse(config, req, 401, 'unauthorized');

      const user = await repo.getOrCreateUser(authed.wallet);
      if (user.id !== authed.sub) {
        // Not fatal in Phase 1, but useful for debugging.
        console.warn('token_user_id_mismatch', { tokenUserId: authed.sub, dbUserId: user.id });
      }

      return jsonResponse(config, req, 200, { user });
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
