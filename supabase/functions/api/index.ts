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
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20?target=deno';

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
  AWS_REGION: string;
  S3_BUCKET: string;
  S3_PRESIGN_EXPIRES_SECONDS: number;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_SESSION_TOKEN?: string;
  DIFY_MODE: 'mock' | 'workflow';
  DIFY_API_URL?: string;
  DIFY_API_KEY?: string;
  DIFY_WORKFLOW_ID?: string;
  DIFY_IMAGE_INPUT_KEY: string;
  DIFY_TIMEOUT_MS: number;
};

function envString(name: string): string | undefined {
  const v = Deno.env.get(name);
  const trimmed = typeof v === 'string' ? v.trim() : '';
  return trimmed ? trimmed : undefined;
}

function loadConfig(): AppConfig {
  const JWT_SECRET = envString('JWT_SECRET');
  // Edge Functions reserve `SUPABASE_*` env var names. Use `BB_*` to avoid conflicts.
  const SUPABASE_URL = envString('BB_SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = envString('BB_SUPABASE_SERVICE_ROLE_KEY');
  const AWS_REGION = envString('AWS_REGION');
  const S3_BUCKET = envString('S3_BUCKET');
  const S3_PRESIGN_EXPIRES_SECONDS = Number(envString('S3_PRESIGN_EXPIRES_SECONDS') ?? '300');

  const DIFY_MODE_RAW = (envString('DIFY_MODE') ?? 'mock').toLowerCase();
  const DIFY_MODE: 'mock' | 'workflow' = DIFY_MODE_RAW === 'workflow' ? 'workflow' : 'mock';
  const DIFY_API_URL = envString('DIFY_API_URL');
  const DIFY_API_KEY = envString('DIFY_API_KEY');
  const DIFY_WORKFLOW_ID = envString('DIFY_WORKFLOW_ID');
  const DIFY_IMAGE_INPUT_KEY = envString('DIFY_IMAGE_INPUT_KEY') ?? 'image_url';
  const DIFY_TIMEOUT_MS = Number(envString('DIFY_TIMEOUT_MS') ?? '20000');

  const missing: string[] = [];
  if (!JWT_SECRET) missing.push('JWT_SECRET');
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!AWS_REGION) missing.push('AWS_REGION');
  if (!S3_BUCKET) missing.push('S3_BUCKET');
  const AWS_ACCESS_KEY_ID = envString('AWS_ACCESS_KEY_ID');
  const AWS_SECRET_ACCESS_KEY = envString('AWS_SECRET_ACCESS_KEY');
  if (!AWS_ACCESS_KEY_ID) missing.push('AWS_ACCESS_KEY_ID');
  if (!AWS_SECRET_ACCESS_KEY) missing.push('AWS_SECRET_ACCESS_KEY');
  if (!Number.isFinite(S3_PRESIGN_EXPIRES_SECONDS) || S3_PRESIGN_EXPIRES_SECONDS <= 0) {
    missing.push('S3_PRESIGN_EXPIRES_SECONDS');
  }
  if (!Number.isFinite(DIFY_TIMEOUT_MS) || DIFY_TIMEOUT_MS <= 0) {
    missing.push('DIFY_TIMEOUT_MS');
  }
  if (DIFY_MODE === 'workflow') {
    if (!DIFY_API_URL) missing.push('DIFY_API_URL');
    if (!DIFY_API_KEY) missing.push('DIFY_API_KEY');
    if (!DIFY_WORKFLOW_ID) missing.push('DIFY_WORKFLOW_ID');
  }
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  return {
    CORS_ORIGIN: envString('CORS_ORIGIN') ?? '*',
    JWT_SECRET,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    AWS_REGION,
    S3_BUCKET,
    S3_PRESIGN_EXPIRES_SECONDS,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN: envString('AWS_SESSION_TOKEN'),
    DIFY_MODE,
    DIFY_API_URL,
    DIFY_API_KEY,
    DIFY_WORKFLOW_ID,
    DIFY_IMAGE_INPUT_KEY,
    DIFY_TIMEOUT_MS
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

type DbReceiptSubmission = {
  id: string;
  user_id: string;
  client_submission_id: string;
  status: string;
  image_bucket: string;
  image_key: string;
  image_content_type: string | null;
  dify_raw: unknown | null;
  dify_drink_list: unknown | null;
  receipt_time_raw: string | null;
  retinfo_is_availd: string | null;
  time_threshold: string | null;
  points_total: number;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
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
    },

    async getSubmissionById(id: string): Promise<DbReceiptSubmission | null> {
      const res = await supabase.from('receipt_submissions').select('*').eq('id', id).maybeSingle();
      const data = ensureOk(res, 'Failed to fetch submission');
      return (data as DbReceiptSubmission) ?? null;
    },

    async getSubmissionByClientId(input: {
      user_id: string;
      client_submission_id: string;
    }): Promise<DbReceiptSubmission | null> {
      const res = await supabase
        .from('receipt_submissions')
        .select('*')
        .eq('user_id', input.user_id)
        .eq('client_submission_id', input.client_submission_id)
        .maybeSingle();
      const data = ensureOk(res, 'Failed to fetch submission by client id');
      return (data as DbReceiptSubmission) ?? null;
    },

    async createSubmission(input: {
      id: string;
      user_id: string;
      client_submission_id: string;
      status: string;
      image_bucket: string;
      image_key: string;
      image_content_type: string | null;
    }): Promise<DbReceiptSubmission> {
      const res = await supabase.from('receipt_submissions').insert(input).select('*').single();
      return ensureOk(res, 'Failed to create submission') as DbReceiptSubmission;
    },

    async updateSubmission(
      id: string,
      patch: Partial<Omit<DbReceiptSubmission, 'id' | 'user_id' | 'created_at'>>
    ): Promise<DbReceiptSubmission> {
      const res = await supabase.from('receipt_submissions').update(patch).eq('id', id).select('*').single();
      return ensureOk(res, 'Failed to update submission') as DbReceiptSubmission;
    },

    async updateSubmissionStatusIfCurrent(input: { id: string; from: string; to: string }): Promise<DbReceiptSubmission | null> {
      const res = await supabase
        .from('receipt_submissions')
        .update({ status: input.to })
        .eq('id', input.id)
        .eq('status', input.from)
        .select('*')
        .maybeSingle();
      const data = ensureOk(res, 'Failed to update submission status');
      return (data as DbReceiptSubmission) ?? null;
    },

    async listSubmissions(userId: string, limit = 20): Promise<DbReceiptSubmission[]> {
      const res = await supabase
        .from('receipt_submissions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      return ensureOk(res, 'Failed to list submissions') as DbReceiptSubmission[];
    }
  };
}

const LOGIN_DOMAIN = Object.freeze({
  name: 'BigBottle',
  version: '1'
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

function normalizeBoolString(input: string): string {
  return input.trim().toLowerCase();
}

const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
  // Some browsers (or file sources) omit the MIME type; our web client falls back to octet-stream.
  'application/octet-stream'
]);

// --- Scoring ---
type DifyDrinkItem = {
  retinfoDrinkCapacity?: unknown;
  retinfoDrinkAmount?: unknown;
};

const MAX_ITEMS = 25;
const MAX_AMOUNT = 20;
const MAX_TOTAL_POINTS = 500;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function parseCapacityMl(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) {
    const v = Math.floor(input);
    return v > 0 ? v : null;
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function parseAmount(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    const v = Math.floor(input);
    return clampInt(v, 1, MAX_AMOUNT);
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return 1;
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n)) return 1;
    return clampInt(n, 1, MAX_AMOUNT);
  }
  return 1;
}

function pointsForCapacityMl(capacityMl: number | null): number {
  if (capacityMl === null) return 0;
  if (capacityMl < 500) return 0;
  if (capacityMl < 1000) return 2;
  if (capacityMl < 2000) return 10;
  return 15;
}

function computeTotalPoints(drinkList: unknown): { totalPoints: number } {
  const list = Array.isArray(drinkList) ? (drinkList as DifyDrinkItem[]).slice(0, MAX_ITEMS) : [];
  const uncapped = list.reduce((sum, item) => {
    const capacityMl = parseCapacityMl(item.retinfoDrinkCapacity);
    const amount = parseAmount(item.retinfoDrinkAmount);
    const tierPoints = pointsForCapacityMl(capacityMl);
    return sum + tierPoints * amount;
  }, 0);
  return { totalPoints: Math.min(uncapped, MAX_TOTAL_POINTS) };
}

// --- Dify ---
type DifyReceiptPayload = {
  drinkList?: unknown;
  retinfoIsAvaild?: unknown;
  retinfoReceiptTime?: unknown;
  timeThreshold?: unknown;
  user_id?: unknown;
};

async function runDify(config: AppConfig, input: { imageUrl: string; userRef: string }) {
  if (config.DIFY_MODE === 'mock') {
    return {
      drinkList: [
        {
          retinfoDrinkName: 'MOCK_WATER',
          retinfoDrinkCapacity: 500,
          retinfoDrinkAmount: 1
        }
      ],
      retinfoIsAvaild: 'true',
      retinfoReceiptTime: '2026-02-04 08:52:00',
      timeThreshold: 'false',
      user_id: input.userRef
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.DIFY_TIMEOUT_MS);

  const url = new URL('/v1/workflows/run', config.DIFY_API_URL);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.DIFY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workflow_id: config.DIFY_WORKFLOW_ID,
        inputs: {
          [config.DIFY_IMAGE_INPUT_KEY]: input.imageUrl
        },
        response_mode: 'blocking',
        user: input.userRef
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dify request failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json();
}

function extractDifyReceiptPayload(raw: unknown): DifyReceiptPayload | null {
  const candidates: unknown[] = [];

  if (typeof raw === 'string') {
    try {
      candidates.push(JSON.parse(raw));
    } catch {
      // ignore
    }
  }
  candidates.push(raw);

  for (const c of candidates) {
    if (!isRecord(c)) continue;

    const direct = c as Record<string, unknown>;
    if ('drinkList' in direct || 'retinfoIsAvaild' in direct || 'timeThreshold' in direct) {
      return direct as DifyReceiptPayload;
    }

    const data = direct.data;
    if (isRecord(data)) {
      const outputs = (data as Record<string, unknown>).outputs;
      if (isRecord(outputs)) return outputs as DifyReceiptPayload;
    }

    const outputs = direct.outputs;
    if (isRecord(outputs)) return outputs as DifyReceiptPayload;
  }

  return null;
}

// --- S3 ---
function s3ObjectUrl(params: { region: string; bucket: string; key: string }): URL {
  // Virtual-hosted style URL. Bucket names with dots require path-style,
  // but our MVP bucket naming convention avoids dots.
  const host =
    params.region === 'us-east-1'
      ? `${params.bucket}.s3.amazonaws.com`
      : `${params.bucket}.s3.${params.region}.amazonaws.com`;
  const encodedKey = params.key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return new URL(`https://${host}/${encodedKey}`);
}

function createS3Client(config: AppConfig): AwsClient {
  return new AwsClient({
    service: 's3',
    region: config.AWS_REGION,
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    sessionToken: config.AWS_SESSION_TOKEN
  });
}

async function presignPutObject(params: {
  s3: AwsClient;
  region: string;
  bucket: string;
  key: string;
  contentType: string;
  expiresInSeconds: number;
  cacheControl?: string;
}): Promise<{ url: string; headers: Record<string, string> }> {
  const url = s3ObjectUrl({ region: params.region, bucket: params.bucket, key: params.key });
  url.searchParams.set('X-Amz-Expires', String(params.expiresInSeconds));

  // For simplicity and compatibility across clients, we do not sign Content-Type.
  // The caller can still pass it in the upload headers.
  const signed = await params.s3.sign(url, {
    method: 'PUT',
    aws: { signQuery: true }
  });

  const headers: Record<string, string> = { 'Content-Type': params.contentType };
  if (params.cacheControl) headers['Cache-Control'] = params.cacheControl;
  return { url: signed.url, headers };
}

async function presignGetObject(params: {
  s3: AwsClient;
  region: string;
  bucket: string;
  key: string;
  expiresInSeconds: number;
}): Promise<{ url: string }> {
  const url = s3ObjectUrl({ region: params.region, bucket: params.bucket, key: params.key });
  url.searchParams.set('X-Amz-Expires', String(params.expiresInSeconds));

  const signed = await params.s3.sign(url, {
    method: 'GET',
    aws: { signQuery: true }
  });
  return { url: signed.url };
}

async function headObject(params: {
  s3: AwsClient;
  region: string;
  bucket: string;
  key: string;
}): Promise<{ contentLength: number | null; contentType: string | null; eTag: string | null } | null> {
  const url = s3ObjectUrl({ region: params.region, bucket: params.bucket, key: params.key });
  const res = await params.s3.fetch(url, { method: 'HEAD' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`S3 head failed: ${res.status} ${res.statusText}`);

  const contentLengthRaw = res.headers.get('content-length');
  const contentLength = contentLengthRaw ? Number.parseInt(contentLengthRaw, 10) : NaN;

  return {
    contentLength: Number.isFinite(contentLength) ? contentLength : null,
    contentType: res.headers.get('content-type'),
    eTag: res.headers.get('etag')
  };
}

async function deleteObject(params: { s3: AwsClient; region: string; bucket: string; key: string }): Promise<void> {
  const url = s3ObjectUrl({ region: params.region, bucket: params.bucket, key: params.key });
  const res = await params.s3.fetch(url, { method: 'DELETE' });
  // DeleteObject is idempotent, but we still treat 404 as success for robustness.
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`S3 delete failed: ${res.status} ${res.statusText}`);
}

const handleRequest: (config: AppConfig) => HttpHandler =
  (config) => async (req, ctx) => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(config, req) });
    }

    if (req.method === 'GET' && ctx.routePath === '/health') {
      return jsonResponse(config, req, 200, { ok: true });
    }

    // Lazily initialize heavy clients only for routes that need them.
    // This avoids hard failures on unknown routes and keeps `/health` extremely cheap.
    let repo: ReturnType<typeof createRepo> | null = null;
    const getRepo = (): ReturnType<typeof createRepo> => {
      if (!repo) {
        const supabase = createSupabaseAdmin(config);
        repo = createRepo(supabase);
      }
      return repo;
    };

    let s3: AwsClient | null = null;
    const getS3 = (): AwsClient => {
      if (!s3) s3 = createS3Client(config);
      return s3;
    };

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

      await getRepo().createAuthChallenge({
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

      const challenge = await getRepo().getAuthChallenge(challengeId);
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

      const claimed = await getRepo().markAuthChallengeUsed(challenge.id);
      if (!claimed) return errorResponse(config, req, 401, 'challenge_used');

      const user = await getRepo().getOrCreateUser(challenge.wallet_address);
      const token = await signAccessToken(config, { sub: user.id, wallet: user.wallet_address });

      return jsonResponse(config, req, 200, {
        access_token: token,
        user: { id: user.id, wallet_address: user.wallet_address, created_at: user.created_at }
      });
    }

    if (req.method === 'GET' && ctx.routePath === '/me') {
      const authed = await requireAuth(config, req);
      if (!authed) return errorResponse(config, req, 401, 'unauthorized');

      const user = await getRepo().getOrCreateUser(authed.wallet);
      if (user.id !== authed.sub) {
        // Not fatal in Phase 1, but useful for debugging.
        console.warn('token_user_id_mismatch', { tokenUserId: authed.sub, dbUserId: user.id });
      }

      return jsonResponse(config, req, 200, { user });
    }

    // --- Submissions ---
    if (req.method === 'POST' && ctx.routePath === '/submissions/init') {
      const authed = await requireAuth(config, req);
      if (!authed) return errorResponse(config, req, 401, 'unauthorized');

      const repo = getRepo();
      const s3 = getS3();

      const body = await readJson(req);
      if (!isRecord(body)) return errorResponse(config, req, 400, 'invalid_body');
      const clientSubmissionId = parseUuid(body.client_submission_id);
      const contentTypeRaw = typeof body.content_type === 'string' ? body.content_type : '';
      if (!clientSubmissionId || !contentTypeRaw) return errorResponse(config, req, 400, 'invalid_body');

      const existing = await repo.getSubmissionByClientId({
        user_id: authed.sub,
        client_submission_id: clientSubmissionId
      });
      if (existing) {
        if (existing.status === 'pending_upload') {
          const existingContentType = (existing.image_content_type || 'application/octet-stream').toLowerCase();
          const upload = await presignPutObject({
            s3,
            region: config.AWS_REGION,
            bucket: existing.image_bucket,
            key: existing.image_key,
            contentType: existingContentType,
            expiresInSeconds: config.S3_PRESIGN_EXPIRES_SECONDS
          });
          return jsonResponse(config, req, 200, { submission: existing, upload: { method: 'PUT', ...upload } });
        }
        return jsonResponse(config, req, 200, { submission: existing, upload: null });
      }

      const contentType = (contentTypeRaw.split(';')[0]?.trim().toLowerCase() ?? '');
      if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(contentType)) {
        return errorResponse(config, req, 400, 'unsupported_content_type');
      }

      const ext =
        contentType === 'image/png'
          ? 'png'
          : contentType === 'image/jpeg'
            ? 'jpg'
            : contentType === 'image/webp'
              ? 'webp'
              : contentType === 'image/heic' || contentType === 'image/heif'
                ? 'heic'
                : 'bin';

      const submissionId = crypto.randomUUID();
      const imageKey = `receipts/${authed.sub}/${clientSubmissionId}.${ext}`;

      let created: DbReceiptSubmission;
      try {
        created = await repo.createSubmission({
          id: submissionId,
          user_id: authed.sub,
          client_submission_id: clientSubmissionId,
          status: 'pending_upload',
          image_bucket: config.S3_BUCKET,
          image_key: imageKey,
          image_content_type: contentType
        });
      } catch (err) {
        console.warn('create_submission_failed', err);
        const again = await repo.getSubmissionByClientId({
          user_id: authed.sub,
          client_submission_id: clientSubmissionId
        });
        if (again) {
          if (again.status === 'pending_upload') {
            const upload = await presignPutObject({
              s3,
              region: config.AWS_REGION,
              bucket: again.image_bucket,
              key: again.image_key,
              contentType: (again.image_content_type || contentType).toLowerCase(),
              expiresInSeconds: config.S3_PRESIGN_EXPIRES_SECONDS
            });
            return jsonResponse(config, req, 200, { submission: again, upload: { method: 'PUT', ...upload } });
          }
          return jsonResponse(config, req, 200, { submission: again, upload: null });
        }
        throw err;
      }

      const upload = await presignPutObject({
        s3,
        region: config.AWS_REGION,
        bucket: created.image_bucket,
        key: created.image_key,
        contentType: (created.image_content_type || contentType).toLowerCase(),
        expiresInSeconds: config.S3_PRESIGN_EXPIRES_SECONDS
      });

      return jsonResponse(config, req, 200, { submission: created, upload: { method: 'PUT', ...upload } });
    }

    const completeMatch = ctx.routePath.match(/^\/submissions\/([^/]+)\/complete$/);
    if (req.method === 'POST' && completeMatch) {
      const authed = await requireAuth(config, req);
      if (!authed) return errorResponse(config, req, 401, 'unauthorized');
      const submissionId = parseUuid(completeMatch[1]);
      if (!submissionId) return errorResponse(config, req, 400, 'invalid_params');

      const repo = getRepo();
      const s3 = getS3();

      const submission = await repo.getSubmissionById(submissionId);
      if (!submission || submission.user_id !== authed.sub) return errorResponse(config, req, 404, 'not_found');

      if (submission.status === 'pending_upload') {
        const meta = await headObject({
          s3,
          region: config.AWS_REGION,
          bucket: submission.image_bucket,
          key: submission.image_key
        });
        if (!meta) return errorResponse(config, req, 409, 'upload_not_found');

        const updated =
          (await repo.updateSubmissionStatusIfCurrent({ id: submission.id, from: 'pending_upload', to: 'uploaded' })) ??
          submission;
        return jsonResponse(config, req, 200, { submission: updated });
      }

      return jsonResponse(config, req, 200, { submission });
    }

    const verifyMatch = ctx.routePath.match(/^\/submissions\/([^/]+)\/verify$/);
    if (req.method === 'POST' && verifyMatch) {
      const authed = await requireAuth(config, req);
      if (!authed) return errorResponse(config, req, 401, 'unauthorized');
      const submissionId = parseUuid(verifyMatch[1]);
      if (!submissionId) return errorResponse(config, req, 400, 'invalid_params');

      const repo = getRepo();
      const s3 = getS3();

      const submission = await repo.getSubmissionById(submissionId);
      if (!submission || submission.user_id !== authed.sub) return errorResponse(config, req, 404, 'not_found');

      if (['verified', 'rejected', 'not_claimable'].includes(submission.status)) {
        return jsonResponse(config, req, 200, { submission });
      }
      if (submission.status === 'pending_upload') {
        return errorResponse(config, req, 409, 'upload_incomplete');
      }
      if (submission.status === 'verifying') {
        return jsonResponse(config, req, 200, { submission });
      }

      const claimed = await repo.updateSubmissionStatusIfCurrent({ id: submission.id, from: 'uploaded', to: 'verifying' });
      if (!claimed) {
        const fresh = await repo.getSubmissionById(submission.id);
        if (!fresh || fresh.user_id !== authed.sub) return errorResponse(config, req, 404, 'not_found');
        return jsonResponse(config, req, 200, { submission: fresh });
      }

      try {
        const meta = await headObject({
          s3,
          region: config.AWS_REGION,
          bucket: claimed.image_bucket,
          key: claimed.image_key
        });
        if (!meta) {
          const reset = await repo.updateSubmission(claimed.id, { status: 'pending_upload' });
          return jsonResponse(config, req, 409, { error: 'upload_incomplete', submission: reset });
        }

        const getUrl = await presignGetObject({
          s3,
          region: config.AWS_REGION,
          bucket: claimed.image_bucket,
          key: claimed.image_key,
          expiresInSeconds: Math.max(60, config.S3_PRESIGN_EXPIRES_SECONDS)
        });

        const difyRaw = await runDify(config, { imageUrl: getUrl.url, userRef: authed.wallet });
        const payload = extractDifyReceiptPayload(difyRaw);

        if (!payload) {
          const updated = await repo.updateSubmission(claimed.id, {
            status: 'rejected',
            dify_raw: difyRaw as any,
            points_total: 0,
            verified_at: new Date().toISOString()
          });
          try {
            await deleteObject({
              s3,
              region: config.AWS_REGION,
              bucket: claimed.image_bucket,
              key: claimed.image_key
            });
          } catch (deleteErr) {
            console.warn('s3_delete_rejected_image_failed', {
              bucket: claimed.image_bucket,
              key: claimed.image_key,
              message: deleteErr instanceof Error ? deleteErr.message : String(deleteErr)
            });
          }
          return jsonResponse(config, req, 200, { submission: updated });
        }

        if (typeof payload.user_id === 'string') {
          const difyUser = payload.user_id.trim();
          if (difyUser && difyUser !== authed.wallet) {
            console.warn('dify_user_id_mismatch_ignored', { difyUser, wallet: authed.wallet });
          }
        }

        const nowIso = new Date().toISOString();
        const retinfoIsAvaildRaw =
          typeof payload.retinfoIsAvaild === 'string' ? payload.retinfoIsAvaild : String(payload.retinfoIsAvaild ?? '');
        const timeThresholdRaw =
          typeof payload.timeThreshold === 'string' ? payload.timeThreshold : String(payload.timeThreshold ?? '');
        const receiptTimeRaw =
          typeof payload.retinfoReceiptTime === 'string'
            ? payload.retinfoReceiptTime
            : payload.retinfoReceiptTime == null
              ? null
              : String(payload.retinfoReceiptTime);

        const retinfoIsAvaild = normalizeBoolString(retinfoIsAvaildRaw);
        const timeThreshold = normalizeBoolString(timeThresholdRaw);

        const ok = retinfoIsAvaild === 'true' && timeThreshold === 'false';
        const { totalPoints } = computeTotalPoints(payload.drinkList);
        const finalStatus = ok ? (totalPoints > 0 ? 'verified' : 'not_claimable') : 'rejected';

        const updated = await repo.updateSubmission(claimed.id, {
          status: finalStatus,
          dify_raw: difyRaw as any,
          dify_drink_list: (payload.drinkList ?? null) as any,
          receipt_time_raw: receiptTimeRaw,
          retinfo_is_availd: retinfoIsAvaild,
          time_threshold: timeThreshold,
          points_total: ok ? totalPoints : 0,
          verified_at: nowIso
        });

        if (updated.status === 'rejected') {
          try {
            await deleteObject({
              s3,
              region: config.AWS_REGION,
              bucket: claimed.image_bucket,
              key: claimed.image_key
            });
          } catch (deleteErr) {
            console.warn('s3_delete_rejected_image_failed', {
              bucket: claimed.image_bucket,
              key: claimed.image_key,
              message: deleteErr instanceof Error ? deleteErr.message : String(deleteErr)
            });
          }
        }
        return jsonResponse(config, req, 200, { submission: updated });
      } catch (err) {
        console.error('verification_failed', err);
        const updated = await repo.updateSubmission(claimed.id, {
          status: 'rejected',
          dify_raw: {
            error: 'verification_failed',
            message: err instanceof Error ? err.message : String(err),
            at: new Date().toISOString()
          } as any,
          points_total: 0,
          verified_at: new Date().toISOString()
        });
        try {
          await deleteObject({
            s3,
            region: config.AWS_REGION,
            bucket: claimed.image_bucket,
            key: claimed.image_key
          });
        } catch (deleteErr) {
          console.warn('s3_delete_rejected_image_failed', {
            bucket: claimed.image_bucket,
            key: claimed.image_key,
            message: deleteErr instanceof Error ? deleteErr.message : String(deleteErr)
          });
        }
        return jsonResponse(config, req, 200, { submission: updated });
      }
    }

    if (req.method === 'GET' && ctx.routePath === '/submissions') {
      const authed = await requireAuth(config, req);
      if (!authed) return errorResponse(config, req, 401, 'unauthorized');
      const rows = await getRepo().listSubmissions(authed.sub, 50);
      return jsonResponse(config, req, 200, { submissions: rows });
    }

    const getMatch = ctx.routePath.match(/^\/submissions\/([^/]+)$/);
    if (req.method === 'GET' && getMatch) {
      const authed = await requireAuth(config, req);
      if (!authed) return errorResponse(config, req, 401, 'unauthorized');
      const submissionId = parseUuid(getMatch[1]);
      if (!submissionId) return errorResponse(config, req, 400, 'invalid_params');

      const submission = await getRepo().getSubmissionById(submissionId);
      if (!submission || submission.user_id !== authed.sub) return errorResponse(config, req, 404, 'not_found');
      return jsonResponse(config, req, 200, { submission });
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
