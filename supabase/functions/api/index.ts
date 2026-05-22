// Supabase Edge Function: API gateway for the BigBottle MVP.
// Runtime: Deno (Supabase Edge Functions).
//
// Routes are designed to mirror the local Fastify API under `apps/api`.
//
// Expected public base URL:
//   https://<project>.supabase.co/functions/v1/api

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20?target=deno";
import { getAddress, getBytes, Interface, formatUnits, verifyTypedData } from "https://esm.sh/ethers@6.15.0?target=deno";
import { SignJWT, jwtVerify } from "https://esm.sh/jose@5.2.4?target=deno";
import { Address, Transaction } from "https://esm.sh/@vechain/sdk-core@2.0.7?target=deno";
import {
  ProviderInternalBaseWallet,
  ThorClient,
  VeChainProvider,
  type TransactionReceipt,
} from "https://esm.sh/@vechain/sdk-network@2.0.7?target=deno";

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

type HttpHandler = (req: Request, ctx: { routePath: string }) => Promise<Response>;

declare const EdgeRuntime:
  | {
      waitUntil: (promise: Promise<unknown>) => void;
    }
  | undefined;

function runInBackground(task: Promise<unknown>): void {
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(task);
    return;
  }
  task.catch((err) => console.error("background_task_failed", err));
}

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
  DIFY_MODE: "mock" | "workflow";
  DIFY_API_URL?: string;
  DIFY_API_KEY?: string;
  DIFY_WORKFLOW_ID?: string;
  DIFY_IMAGE_INPUT_KEY: string;
  DIFY_TIMEOUT_MS: number;
  REWARDS_MODE: "mock" | "chain";
  VECHAIN_NETWORK: "testnet" | "mainnet";
  VECHAIN_NODE_URL?: string;
  VEBETTER_APP_ID?: string;
  X2EARN_REWARDS_POOL_ADDRESS?: string;
  FEE_DELEGATION_URL?: string;
  REWARD_DISTRIBUTOR_PRIVATE_KEY?: string;
  VEBETTER_CURRENT_EFFECTIVE_ROUND_ID?: number;
  // VeChain mainnet config for GM-NFT lookup
  VECHAIN_THOR_URL?: string;
  VEBETTER_GALAXY_MEMBER_ADDRESS?: string;
};

function envString(name: string): string | undefined {
  const v = Deno.env.get(name);
  const trimmed = typeof v === "string" ? v.trim() : "";
  return trimmed ? trimmed : undefined;
}

function loadConfig(): AppConfig {
  const JWT_SECRET = envString("JWT_SECRET");
  // Edge Functions reserve `SUPABASE_*` env var names. Use `BB_*` to avoid conflicts.
  const SUPABASE_URL = envString("BB_SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = envString("BB_SUPABASE_SERVICE_ROLE_KEY");
  const AWS_REGION = envString("AWS_REGION");
  const S3_BUCKET = envString("S3_BUCKET");
  const S3_PRESIGN_EXPIRES_SECONDS = Number(envString("S3_PRESIGN_EXPIRES_SECONDS") ?? "300");

  const DIFY_MODE_RAW = (envString("DIFY_MODE") ?? "mock").toLowerCase();
  const DIFY_MODE: "mock" | "workflow" = DIFY_MODE_RAW === "workflow" ? "workflow" : "mock";
  const DIFY_API_URL = envString("DIFY_API_URL");
  const DIFY_API_KEY = envString("DIFY_API_KEY");
  const DIFY_WORKFLOW_ID = envString("DIFY_WORKFLOW_ID");
  const DIFY_IMAGE_INPUT_KEY = envString("DIFY_IMAGE_INPUT_KEY") ?? "image_url";
  const DIFY_TIMEOUT_MS = Number(envString("DIFY_TIMEOUT_MS") ?? "20000");
  const REWARDS_MODE_RAW = (envString("REWARDS_MODE") ?? "mock").toLowerCase();
  const REWARDS_MODE: "mock" | "chain" = REWARDS_MODE_RAW === "chain" ? "chain" : "mock";
  const VECHAIN_NETWORK_RAW = (envString("VECHAIN_NETWORK") ?? "testnet").toLowerCase();
  const VECHAIN_NETWORK: "testnet" | "mainnet" =
    VECHAIN_NETWORK_RAW === "mainnet" ? "mainnet" : "testnet";
  const VECHAIN_NODE_URL = envString("VECHAIN_NODE_URL");
  const VEBETTER_APP_ID = envString("VEBETTER_APP_ID");
  const X2EARN_REWARDS_POOL_ADDRESS = envString("X2EARN_REWARDS_POOL_ADDRESS");
  const FEE_DELEGATION_URL = envString("FEE_DELEGATION_URL");
  const REWARD_DISTRIBUTOR_PRIVATE_KEY = envString("REWARD_DISTRIBUTOR_PRIVATE_KEY");
  const VEBETTER_CURRENT_EFFECTIVE_ROUND_ID_RAW = envString("VEBETTER_CURRENT_EFFECTIVE_ROUND_ID");
  const VEBETTER_CURRENT_EFFECTIVE_ROUND_ID =
    VEBETTER_CURRENT_EFFECTIVE_ROUND_ID_RAW === undefined
      ? undefined
      : Number(VEBETTER_CURRENT_EFFECTIVE_ROUND_ID_RAW);

  const missing: string[] = [];
  if (!JWT_SECRET) missing.push("JWT_SECRET");
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!AWS_REGION) missing.push("AWS_REGION");
  if (!S3_BUCKET) missing.push("S3_BUCKET");
  const AWS_ACCESS_KEY_ID = envString("AWS_ACCESS_KEY_ID");
  const AWS_SECRET_ACCESS_KEY = envString("AWS_SECRET_ACCESS_KEY");
  if (!AWS_ACCESS_KEY_ID) missing.push("AWS_ACCESS_KEY_ID");
  if (!AWS_SECRET_ACCESS_KEY) missing.push("AWS_SECRET_ACCESS_KEY");
  if (!Number.isFinite(S3_PRESIGN_EXPIRES_SECONDS) || S3_PRESIGN_EXPIRES_SECONDS <= 0) {
    missing.push("S3_PRESIGN_EXPIRES_SECONDS");
  }
  if (!Number.isFinite(DIFY_TIMEOUT_MS) || DIFY_TIMEOUT_MS <= 0) {
    missing.push("DIFY_TIMEOUT_MS");
  }
  if (DIFY_MODE === "workflow") {
    if (!DIFY_API_URL) missing.push("DIFY_API_URL");
    if (!DIFY_API_KEY) missing.push("DIFY_API_KEY");
    if (!DIFY_WORKFLOW_ID) missing.push("DIFY_WORKFLOW_ID");
  }
  if (REWARDS_MODE === "chain") {
    if (!VEBETTER_APP_ID) missing.push("VEBETTER_APP_ID");
    if (!X2EARN_REWARDS_POOL_ADDRESS) missing.push("X2EARN_REWARDS_POOL_ADDRESS");
    if (!FEE_DELEGATION_URL) missing.push("FEE_DELEGATION_URL");
    if (!REWARD_DISTRIBUTOR_PRIVATE_KEY) missing.push("REWARD_DISTRIBUTOR_PRIVATE_KEY");
  }
  if (
    VEBETTER_CURRENT_EFFECTIVE_ROUND_ID_RAW !== undefined &&
    (!Number.isInteger(VEBETTER_CURRENT_EFFECTIVE_ROUND_ID) || VEBETTER_CURRENT_EFFECTIVE_ROUND_ID <= 0)
  ) {
    missing.push("VEBETTER_CURRENT_EFFECTIVE_ROUND_ID");
  }
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  return {
    CORS_ORIGIN: envString("CORS_ORIGIN") ?? "*",
    JWT_SECRET,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    AWS_REGION,
    S3_BUCKET,
    S3_PRESIGN_EXPIRES_SECONDS,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN: envString("AWS_SESSION_TOKEN"),
    DIFY_MODE,
    DIFY_API_URL,
    DIFY_API_KEY,
    DIFY_WORKFLOW_ID,
    DIFY_IMAGE_INPUT_KEY,
    DIFY_TIMEOUT_MS,
    REWARDS_MODE,
    VECHAIN_NETWORK,
    VECHAIN_NODE_URL,
    VEBETTER_APP_ID,
    X2EARN_REWARDS_POOL_ADDRESS,
    FEE_DELEGATION_URL,
    REWARD_DISTRIBUTOR_PRIVATE_KEY,
    VEBETTER_CURRENT_EFFECTIVE_ROUND_ID,
    // GM-NFT lookup defaults
    VECHAIN_THOR_URL: envString("VECHAIN_THOR_URL") ?? "https://mainnet.vechain.org",
    VEBETTER_GALAXY_MEMBER_ADDRESS: envString("VEBETTER_GALAXY_MEMBER_ADDRESS") ?? "0x93B8cD34A7Fc4f53271b9011161F7A2B5fEA9D1F",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUuid(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim();
  if (!v) return null;
  // Strict UUID v4-ish validation is unnecessary here; keep it simple but safe.
  if (!/^[0-9a-fA-F-]{36}$/.test(v)) return null;
  return v;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getRoutePath(pathname: string): string {
  // Supabase typically calls the function at:
  //   /functions/v1/<name>/<subpath?>
  // but we keep this robust for local proxies and future changes.
  const prefixes = ["/functions/v1/api", "/api"];
  for (const p of prefixes) {
    if (pathname === p) return "/";
    if (pathname.startsWith(`${p}/`)) return pathname.slice(p.length);
  }
  return pathname;
}

function corsHeaders(config: AppConfig, req: Request): Headers {
  const h = new Headers();
  const reqOrigin = req.headers.get("origin") ?? "";

  if (config.CORS_ORIGIN === "*" || !config.CORS_ORIGIN) {
    h.set("access-control-allow-origin", "*");
  } else {
    // Keep it simple for MVP: single allowed origin.
    h.set("access-control-allow-origin", config.CORS_ORIGIN);
    if (reqOrigin && reqOrigin !== config.CORS_ORIGIN) {
      // Still respond with the configured origin, but flag it for debugging.
      h.set("x-cors-origin-mismatch", reqOrigin);
    }
  }

  h.set("access-control-allow-methods", "GET,POST,OPTIONS");
  h.set("access-control-allow-headers", "authorization,content-type,accept");
  h.set("access-control-max-age", "86400");
  return h;
}

function jsonResponse(config: AppConfig, req: Request, status: number, body: Json): Response {
  const headers = corsHeaders(config, req);
  headers.set("content-type", "application/json; charset=utf-8");
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
  points_base: number;
  points_multiplier: number | string;
  points_bonus_sources: unknown;
  points_total: number;
  receipt_fingerprint: string | null;
  rejection_code: string | null;
  duplicate_of: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

type DbRewardConversionRate = {
  id: string;
  points_per_b3tr: number;
  active: boolean;
  created_at: string;
};

type DbRewardClaim = {
  id: string;
  user_id: string;
  wallet_address: string;
  client_claim_id: string;
  conversion_rate_id: string;
  points_per_b3tr_snapshot: number;
  points_claimed: number;
  b3tr_amount_wei: string;
  status: string;
  tx_hash: string | null;
  raw_tx: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

type DbRewardClaimSource = {
  claim_id: string;
  submission_id: string;
  points_total: number;
  receipt_fingerprint: string | null;
  dify_drink_list: unknown | null;
  created_at: string;
};

type DbVoteBonusEligibility = {
  effective_round_id: number;
  source_round_id: number;
  passport_address: string;
  user_id: string | null;
  bonus_type: string;
  bonus_multiplier: number | string;
  status: string;
  source: string;
  computed_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type DbAchievementDefinition = {
  key: string;
  title: string;
  badge: string;
  enabled: boolean;
  sort_order: number;
  base_multiplier: number | string;
  locked_tag_label: string | null;
  unlocked_tag_label_template: string | null;
  locked_description: string | null;
  unlocked_description_template: string | null;
  level_config: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

type AchievementDefinition = {
  key: string;
  title: string;
  badge: string;
  enabled: boolean;
  sort_order: number;
  base_multiplier: number;
  locked_tag_label: string | null;
  unlocked_tag_label_template: string | null;
  locked_description: string;
  unlocked_description_template: string;
  level_names: Record<number, string>;
  metadata: Record<string, unknown>;
};

function ensureOk<T>(res: { data: T; error: unknown | null }, message: string): T {
  if (res.error) {
    const errText = typeof res.error === "object" ? JSON.stringify(res.error) : String(res.error);
    // Preserve the structured PostgREST error for callers that need to inspect error codes.
    throw new Error(`${message}: ${errText}`, { cause: res.error });
  }
  return res.data;
}

function createSupabaseAdmin(config: AppConfig): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function createRepo(supabase: SupabaseClient) {
  return {
    async getOrCreateUser(walletAddressLower: string): Promise<DbUser> {
      const upsertRes = await supabase
        .from("users")
        .upsert({ wallet_address: walletAddressLower }, { onConflict: "wallet_address" })
        .select("*")
        .single();

      return ensureOk(upsertRes, "Failed to upsert user") as DbUser;
    },

    async createAuthChallenge(input: {
      id: string;
      wallet_address: string;
      nonce: string;
      expires_at: string;
    }): Promise<DbAuthChallenge> {
      const res = await supabase.from("auth_challenges").insert(input).select("*").single();
      return ensureOk(res, "Failed to create auth challenge") as DbAuthChallenge;
    },

    async getAuthChallenge(id: string): Promise<DbAuthChallenge | null> {
      const res = await supabase.from("auth_challenges").select("*").eq("id", id).maybeSingle();
      const data = ensureOk(res, "Failed to fetch auth challenge");
      return (data as DbAuthChallenge) ?? null;
    },

    async markAuthChallengeUsed(id: string): Promise<boolean> {
      const res = await supabase
        .from("auth_challenges")
        .update({ used_at: new Date().toISOString() })
        .eq("id", id)
        .is("used_at", null)
        .select("id")
        .maybeSingle();
      const data = ensureOk(res, "Failed to mark auth challenge used");
      return data !== null;
    },

    async getSubmissionById(id: string): Promise<DbReceiptSubmission | null> {
      const res = await supabase.from("receipt_submissions").select("*").eq("id", id).maybeSingle();
      const data = ensureOk(res, "Failed to fetch submission");
      return (data as DbReceiptSubmission) ?? null;
    },

    async getSubmissionByClientId(input: {
      user_id: string;
      client_submission_id: string;
    }): Promise<DbReceiptSubmission | null> {
      const res = await supabase
        .from("receipt_submissions")
        .select("*")
        .eq("user_id", input.user_id)
        .eq("client_submission_id", input.client_submission_id)
        .maybeSingle();
      const data = ensureOk(res, "Failed to fetch submission by client id");
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
      const res = await supabase.from("receipt_submissions").insert(input).select("*").single();
      return ensureOk(res, "Failed to create submission") as DbReceiptSubmission;
    },

    async countSubmissionsCreatedInWindow(input: {
      user_id: string;
      start_iso: string;
      end_iso: string;
    }): Promise<number> {
      const res = await supabase
        .from("receipt_submissions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", input.user_id)
        .gte("created_at", input.start_iso)
        .lt("created_at", input.end_iso);
      ensureOk(res, "Failed to count daily submissions");
      return res.count ?? 0;
    },

    async countVerifiedSubmissionsCreatedInWindow(input: {
      user_id: string;
      start_iso: string;
      end_iso: string;
    }): Promise<number> {
      const res = await supabase
        .from("receipt_submissions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", input.user_id)
        .eq("status", "verified")
        .gte("created_at", input.start_iso)
        .lt("created_at", input.end_iso);
      ensureOk(res, "Failed to count daily verified submissions");
      return res.count ?? 0;
    },

    async updateSubmission(
      id: string,
      patch: Partial<Omit<DbReceiptSubmission, "id" | "user_id" | "created_at">>,
    ): Promise<DbReceiptSubmission> {
      const res = await supabase
        .from("receipt_submissions")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      return ensureOk(res, "Failed to update submission") as DbReceiptSubmission;
    },

    async computeReceiptFingerprint(input: {
      receipt_time_raw: string | null;
      dify_drink_list: unknown | null;
    }): Promise<string | null> {
      const res = await supabase.rpc("bb_receipt_fingerprint", {
        receipt_time_raw: input.receipt_time_raw,
        dify_drink_list: input.dify_drink_list as any,
      });
      const data = ensureOk(res, "Failed to compute receipt fingerprint");
      return typeof data === "string" && data.trim() ? data.trim() : null;
    },

    async getUserPointsTotal(userId: string): Promise<number> {
      const res = await supabase.rpc("bb_user_points_total", { user_id: userId });
      const data = ensureOk(res, "Failed to compute user points total");
      return typeof data === "number" && Number.isFinite(data) ? data : 0;
    },

    async getUserPointsLocked(userId: string): Promise<number> {
      const res = await supabase.rpc("bb_user_points_locked", { user_id: userId });
      const data = ensureOk(res, "Failed to compute user points locked");
      return typeof data === "number" && Number.isFinite(data) ? data : 0;
    },

    async getActiveRewardConversionRate(): Promise<DbRewardConversionRate | null> {
      const res = await supabase
        .from("reward_conversion_rates")
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const data = ensureOk(res, "Failed to fetch active reward conversion rate");
      return (data as DbRewardConversionRate) ?? null;
    },

    async getRewardClaimById(id: string): Promise<DbRewardClaim | null> {
      const res = await supabase.from("reward_claims").select("*").eq("id", id).maybeSingle();
      const data = ensureOk(res, "Failed to fetch reward claim");
      return (data as DbRewardClaim) ?? null;
    },

    async getRewardClaimByClientId(input: {
      user_id: string;
      client_claim_id: string;
    }): Promise<DbRewardClaim | null> {
      const res = await supabase
        .from("reward_claims")
        .select("*")
        .eq("user_id", input.user_id)
        .eq("client_claim_id", input.client_claim_id)
        .maybeSingle();
      const data = ensureOk(res, "Failed to fetch reward claim by client id");
      return (data as DbRewardClaim) ?? null;
    },

    async getInflightRewardClaim(userId: string): Promise<DbRewardClaim | null> {
      const res = await supabase
        .from("reward_claims")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["pending", "submitted"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const data = ensureOk(res, "Failed to fetch inflight reward claim");
      return (data as DbRewardClaim) ?? null;
    },

    async listRewardClaimSourceSubmissions(userId: string): Promise<DbReceiptSubmission[]> {
      const res = await supabase.rpc("bb_reward_claim_source_submissions", { user_id: userId });
      return ensureOk(res, "Failed to fetch reward claim source submissions") as DbReceiptSubmission[];
    },

    async createRewardClaim(input: {
      user_id: string;
      wallet_address: string;
      client_claim_id: string;
      conversion_rate_id: string;
      points_per_b3tr_snapshot: number;
      points_claimed: number;
      b3tr_amount_wei: string;
      status: string;
    }): Promise<DbRewardClaim> {
      const res = await supabase.from("reward_claims").insert(input).select("*").single();
      return ensureOk(res, "Failed to create reward claim") as DbRewardClaim;
    },

    async updateRewardClaim(
      id: string,
      patch: Partial<Omit<DbRewardClaim, "id" | "user_id" | "created_at">>,
    ): Promise<DbRewardClaim> {
      const res = await supabase
        .from("reward_claims")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      return ensureOk(res, "Failed to update reward claim") as DbRewardClaim;
    },

    async createRewardClaimSources(inputs: Array<{
      claim_id: string;
      submission_id: string;
      points_total: number;
      receipt_fingerprint: string | null;
      dify_drink_list: unknown | null;
    }>): Promise<DbRewardClaimSource[]> {
      if (inputs.length === 0) return [];
      const res = await supabase.from("reward_claim_sources").insert(inputs).select("*");
      return ensureOk(res, "Failed to create reward claim sources") as DbRewardClaimSource[];
    },

    async listRewardClaims(userId: string, limit = 20): Promise<DbRewardClaim[]> {
      const res = await supabase
        .from("reward_claims")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      return ensureOk(res, "Failed to list reward claims") as DbRewardClaim[];
    },

    async getLatestUserBonusEligibility(input: {
      user_id: string;
      wallet_address: string;
      bonus_type: string;
      effective_round_id?: number;
    }): Promise<DbVoteBonusEligibility | null> {
      const walletLower = input.wallet_address.trim().toLowerCase();
      const orFilter = `user_id.eq.${input.user_id},passport_address.eq.${walletLower}`;
      const query = supabase
        .from("bigbottle_vote_bonus_eligibility")
        .select("*")
        .eq("bonus_type", input.bonus_type)
        .eq("status", "eligible")
        .or(orFilter);
      const filteredQuery =
        input.effective_round_id === undefined
          ? query
          : query.eq("effective_round_id", input.effective_round_id);
      const res = await filteredQuery
        .order("effective_round_id", { ascending: false })
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const data = ensureOk(res, "Failed to fetch user bonus eligibility");
      return (data as DbVoteBonusEligibility) ?? null;
    },

    async listAchievementDefinitions(keys?: string[]): Promise<DbAchievementDefinition[]> {
      let query = supabase
        .from("achievement_definitions")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("key", { ascending: true });
      if (keys && keys.length > 0) {
        query = query.in("key", keys);
      }
      const res = await query;
      return ensureOk(res, "Failed to list achievement definitions") as DbAchievementDefinition[];
    },

    async getVerifiedSubmissionByFingerprint(
      fingerprint: string,
    ): Promise<Pick<DbReceiptSubmission, "id" | "user_id" | "created_at"> | null> {
      const res = await supabase
        .from("receipt_submissions")
        .select("id,user_id,created_at")
        .eq("receipt_fingerprint", fingerprint)
        .eq("status", "verified")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const data = ensureOk(res, "Failed to fetch submission by fingerprint");
      return (data as any) ?? null;
    },

    async updateSubmissionStatusIfCurrent(input: {
      id: string;
      from: string;
      to: string;
    }): Promise<DbReceiptSubmission | null> {
      const res = await supabase
        .from("receipt_submissions")
        .update({ status: input.to })
        .eq("id", input.id)
        .eq("status", input.from)
        .select("*")
        .maybeSingle();
      const data = ensureOk(res, "Failed to update submission status");
      return (data as DbReceiptSubmission) ?? null;
    },

    async listSubmissions(userId: string, limit = 20): Promise<DbReceiptSubmission[]> {
      const res = await supabase
        .from("receipt_submissions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      return ensureOk(res, "Failed to list submissions") as DbReceiptSubmission[];
    },
  };
}

const DEFAULT_CHAIN_ID = 100010;
const LOGIN_CHAIN_ID =
  Number.parseInt(Deno.env.get("VECHAIN_CHAIN_ID") ?? "", 10) || DEFAULT_CHAIN_ID;

const LOGIN_DOMAIN = Object.freeze({
  name: "BigBottle",
  version: "1",
  chainId: LOGIN_CHAIN_ID,
});

const LOGIN_TYPES = Object.freeze({
  Login: [
    { name: "challengeId", type: "string" },
    { name: "wallet", type: "address" },
    { name: "nonce", type: "string" },
  ],
});

function buildLoginTypedData(params: {
  walletAddress: string;
  challengeId: string;
  nonce: string;
}) {
  const wallet = getAddress(params.walletAddress);
  return {
    domain: LOGIN_DOMAIN,
    types: LOGIN_TYPES,
    value: {
      challengeId: params.challengeId,
      wallet,
      nonce: params.nonce,
    },
  } as const;
}

function verifyLoginSignature(params: {
  walletAddress: string;
  challengeId: string;
  nonce: string;
  signature: string;
}): boolean {
  const wallet = getAddress(params.walletAddress);

  const typedDataWithChainId = buildLoginTypedData({
    walletAddress: wallet,
    challengeId: params.challengeId,
    nonce: params.nonce,
  });

  try {
    const recovered = verifyTypedData(
      typedDataWithChainId.domain,
      typedDataWithChainId.types,
      typedDataWithChainId.value,
      params.signature,
    );
    if (getAddress(recovered) === wallet) return true;
  } catch {
    // Fall through to legacy domain verification without chainId.
  }

  const { chainId: _unused, ...legacyDomain } = typedDataWithChainId.domain;

  try {
    const recovered = verifyTypedData(
      legacyDomain,
      typedDataWithChainId.types,
      typedDataWithChainId.value,
      params.signature,
    );
    return getAddress(recovered) === wallet;
  } catch {
    return false;
  }
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
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .setSubject(user.sub)
    .sign(jwtKey(config));
}

async function verifyAccessToken(config: AppConfig, token: string): Promise<AuthedUser | null> {
  try {
    const { payload } = await jwtVerify(token, jwtKey(config), { algorithms: ["HS256"] });
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    const wallet =
      typeof (payload as any).wallet === "string" ? String((payload as any).wallet) : "";
    if (!sub || !wallet) return null;
    return { sub, wallet };
  } catch {
    return null;
  }
}

async function requireAuth(config: AppConfig, req: Request): Promise<AuthedUser | null> {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return await verifyAccessToken(config, m[1] ?? "");
}

// --- Achievements + GM-NFT lookup ---
const GM_NFT_LEVEL_NAMES: Record<number, string> = {
  0: "No GM NFT",
  1: "Earth",
  2: "Moon",
  3: "Mercury",
  4: "Venus",
  5: "Mars",
  6: "Jupiter",
  7: "Saturn",
  8: "Uranus",
  9: "Neptune",
  10: "Galaxy",
};

const DEFAULT_ACHIEVEMENT_DEFINITIONS: Record<string, AchievementDefinition> = {
  vebetter_vote_bonus: {
    key: "vebetter_vote_bonus",
    title: "VeBetterDAO Voter",
    badge: "governance",
    enabled: true,
    sort_order: 10,
    base_multiplier: 10,
    locked_tag_label: "投票用户",
    unlocked_tag_label_template: "投票用户",
    locked_description: "在 VeBetterDAO 任一投票中参与过投票，下期获得 BigPortal 积分加成。",
    unlocked_description_template: "在 VeBetterDAO 任一投票中参与过投票，下期获得 BigPortal 积分加成。",
    level_names: {},
    metadata: {},
  },
  gm_nft: {
    key: "gm_nft",
    title: "GM-NFT",
    badge: "gm_nft",
    enabled: true,
    sort_order: 20,
    base_multiplier: 10,
    locked_tag_label: "GM-NFT",
    unlocked_tag_label_template: "GM-NFT · {{level_name}}",
    locked_description: "未检测到 GM-NFT。",
    unlocked_description_template: "已持有最高等级 GM-NFT：{{level_name}}",
    level_names: GM_NFT_LEVEL_NAMES,
    metadata: {},
  },
};

type ReceiptBonusSource =
  | {
      type: "vebetter_vote_bonus";
      multiplier: number;
      effective_round_id: number;
      source_round_id: number;
    }
  | {
      type: "gm_nft";
      multiplier: number;
      level: number;
      name: string;
    };

type ReceiptBonusSnapshot = {
  multiplier: number;
  sources: ReceiptBonusSource[];
};

const EMPTY_RECEIPT_BONUS_SNAPSHOT: ReceiptBonusSnapshot = {
  multiplier: 1,
  sources: [],
};

function toSafeMultiplier(value: unknown, fallback = 1): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, n);
}

function resolveBonusMultiplier(value: unknown, defaultMultiplier: number): number {
  return Math.max(toSafeMultiplier(value, defaultMultiplier), defaultMultiplier);
}

function computeAdditiveBonusMultiplier(multipliers: number[]): number {
  const unlockedMultipliers = multipliers.filter((value) => Number.isFinite(value) && value > 1);
  if (unlockedMultipliers.length === 0) return 1;
  return unlockedMultipliers.reduce((sum, value) => sum + value, 0);
}

function applyPointsMultiplier(basePoints: number, multiplier: number): number {
  if (!Number.isInteger(basePoints) || basePoints < 0) {
    throw new Error("base_points_invalid");
  }
  if (!Number.isFinite(multiplier) || multiplier < 1) {
    throw new Error("points_multiplier_invalid");
  }
  return Math.floor(basePoints * multiplier);
}

function computeAchievementTotalMultiplier(items: Array<{ unlocked: boolean; multiplier: number }>): number {
  return computeAdditiveBonusMultiplier(items.filter((item) => item.unlocked).map((item) => item.multiplier));
}

function parseLevelNames(input: unknown, fallback: Record<number, string>): Record<number, string> {
  if (!isRecord(input)) return fallback;
  const container = isRecord(input.level_names) ? input.level_names : input;
  const entries = Object.entries(container)
    .map(([key, value]) => {
      const level = Number(key);
      const name = typeof value === "string" ? value.trim() : "";
      return Number.isFinite(level) && name ? [level, name] as const : null;
    })
    .filter((entry): entry is readonly [number, string] => entry !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : fallback;
}

function parseMetadata(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : {};
}

function resolveAchievementDefinition(
  row: DbAchievementDefinition | null | undefined,
  fallback: AchievementDefinition,
): AchievementDefinition {
  return {
    key: row?.key?.trim() || fallback.key,
    title: typeof row?.title === "string" && row.title.trim() ? row.title.trim() : fallback.title,
    badge: typeof row?.badge === "string" && row.badge.trim() ? row.badge.trim() : fallback.badge,
    enabled: typeof row?.enabled === "boolean" ? row.enabled : fallback.enabled,
    sort_order:
      typeof row?.sort_order === "number" && Number.isFinite(row.sort_order)
        ? row.sort_order
        : fallback.sort_order,
    base_multiplier: toSafeMultiplier(row?.base_multiplier, fallback.base_multiplier),
    locked_tag_label:
      typeof row?.locked_tag_label === "string" && row.locked_tag_label.trim()
        ? row.locked_tag_label.trim()
        : fallback.locked_tag_label,
    unlocked_tag_label_template:
      typeof row?.unlocked_tag_label_template === "string" && row.unlocked_tag_label_template.trim()
        ? row.unlocked_tag_label_template.trim()
        : fallback.unlocked_tag_label_template,
    locked_description:
      typeof row?.locked_description === "string" && row.locked_description.trim()
        ? row.locked_description.trim()
        : fallback.locked_description,
    unlocked_description_template:
      typeof row?.unlocked_description_template === "string" && row.unlocked_description_template.trim()
        ? row.unlocked_description_template.trim()
        : fallback.unlocked_description_template,
    level_names: parseLevelNames(row?.level_config, fallback.level_names),
    metadata: parseMetadata(row?.metadata),
  };
}

function resolveAchievementDefinitions(rows: DbAchievementDefinition[]): AchievementDefinition[] {
  const rowMap = new Map(rows.map((row) => [row.key, row]));
  return Object.values(DEFAULT_ACHIEVEMENT_DEFINITIONS)
    .map((fallback) => resolveAchievementDefinition(rowMap.get(fallback.key), fallback))
    .filter((item) => item.enabled)
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

function resolveConfiguredLevelName(def: AchievementDefinition, level: number | null, fallback?: string | null): string | null {
  if (level === null || !Number.isFinite(level)) return fallback ?? null;
  return def.level_names[level] ?? fallback ?? `Level ${level}`;
}

function resolveGmNftName(level: number, levelNames: Record<number, string> = GM_NFT_LEVEL_NAMES): string {
  return levelNames[level] ?? `Level ${level}`;
}

// ABI fragments as hex selectors for Thor contract calls
const BALANCE_OF_SELECTOR = "0x70a08231"; // balanceOf(address)
const TOKEN_OF_OWNER_BY_INDEX_SELECTOR = "0x2f745c59"; // tokenOfOwnerByIndex(address,uint256)
const GET_TOKEN_INFO_SELECTOR = "0x643ce418"; // getTokenInfoByTokenId(uint256)

async function callThorContract(
  thorUrl: string,
  contract: string,
  data: string,
  caller: string,
): Promise<string> {
  const res = await fetch(`${thorUrl}/accounts/*`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clauses: [{ to: contract, data, value: "0x0" }],
      caller,
    }),
  });

  if (!res.ok) {
    throw new Error(`thor call failed: ${res.status}`);
  }

  const payload = (await res.json()) as Array<{ data?: string }>;
  const output = payload?.[0]?.data;
  if (!output || output === "0x") {
    throw new Error("thor call returned empty data");
  }
  return output;
}

// Decode uint256 from hex (big-endian)
function decodeUint256(hex: string): bigint {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return BigInt(`0x${clean}`);
}

// Encode address to 32-byte hex
function encodeAddress(addr: string): string {
  const clean = addr.toLowerCase().replace(/^0x/, "");
  return "0".repeat(24) + clean;
}

// Encode uint256 to 32-byte hex
function encodeUint256(n: bigint): string {
  const hex = n.toString(16);
  return "0".repeat(64 - hex.length) + hex;
}

async function getHighestGmNftByOwner(
  config: AppConfig,
  walletAddress: string,
): Promise<{ level: number; name: string } | null> {
  const thorUrl = config.VECHAIN_THOR_URL ?? "https://mainnet.vechain.org";
  const contract = config.VEBETTER_GALAXY_MEMBER_ADDRESS ?? "0x93B8cD34A7Fc4f53271b9011161F7A2B5fEA9D1F";

  // balanceOf(walletAddress)
  const balanceData = BALANCE_OF_SELECTOR + encodeAddress(walletAddress);
  const balanceHex = await callThorContract(thorUrl, contract, balanceData, walletAddress);
  const balance = Number(decodeUint256(balanceHex));

  if (!Number.isFinite(balance) || balance <= 0) return null;

  let highestLevel = 0;

  for (let i = 0; i < balance; i++) {
    // tokenOfOwnerByIndex(walletAddress, i)
    const tokenIdData = TOKEN_OF_OWNER_BY_INDEX_SELECTOR + encodeAddress(walletAddress) + encodeUint256(BigInt(i));
    const tokenIdHex = await callThorContract(thorUrl, contract, tokenIdData, walletAddress);
    const tokenId = decodeUint256(tokenIdHex);

    // getTokenInfoByTokenId(tokenId) - parse tokenLevel from result
    const tokenInfoData = GET_TOKEN_INFO_SELECTOR + encodeUint256(tokenId);
    const tokenInfoHex = await callThorContract(thorUrl, contract, tokenInfoData, walletAddress);

    // getTokenInfoByTokenId(tokenId) returns tuple:
    // (uint256 tokenId, string tokenURI, uint256 tokenLevel, uint256 b3trToUpgrade)
    // Layout:
    // - offset to tuple (32 bytes)
    // - tokenId (32 bytes)
    // - offset to tokenURI string (32 bytes)
    // - tokenLevel (32 bytes) <- at offset 96 bytes = hex chars 192
    // - b3trToUpgrade (32 bytes)
    const cleanHex = tokenInfoHex.startsWith("0x") ? tokenInfoHex.slice(2) : tokenInfoHex;
    const tokenLevelHex = cleanHex.slice(192, 256); // bytes 96-127
    const level = Number(decodeUint256("0x" + tokenLevelHex));

    if (Number.isFinite(level) && level > highestLevel) {
      highestLevel = level;
    }
  }

  if (highestLevel <= 0) return null;

  return {
    level: highestLevel,
    name: resolveGmNftName(highestLevel),
  };
}

async function getReceiptBonusSnapshot(input: {
  config: AppConfig;
  repo: ReturnType<typeof createRepo>;
  userId: string;
  wallet: string;
  effectiveRoundId?: number;
}): Promise<ReceiptBonusSnapshot> {
  const sources: ReceiptBonusSource[] = [];

  try {
    const vebetterVote = await input.repo.getLatestUserBonusEligibility({
      user_id: input.userId,
      wallet_address: input.wallet,
      bonus_type: "vebetter_vote_bonus",
      ...(input.effectiveRoundId === undefined ? {} : { effective_round_id: input.effectiveRoundId }),
    });
    if (vebetterVote) {
      const defaultMultiplier = toSafeMultiplier(DEFAULT_ACHIEVEMENT_DEFINITIONS.vebetter_vote_bonus.base_multiplier);
      const multiplier = resolveBonusMultiplier(vebetterVote.bonus_multiplier, defaultMultiplier);
      sources.push({
        type: "vebetter_vote_bonus",
        multiplier,
        effective_round_id: vebetterVote.effective_round_id,
        source_round_id: vebetterVote.source_round_id,
      });
    }
  } catch (err) {
    console.warn("vote_bonus_lookup_failed", { wallet: input.wallet, userId: input.userId, error: String(err) });
  }

  try {
    const highestGmNft = await getHighestGmNftByOwner(input.config, input.wallet);
    if (highestGmNft) {
      sources.push({
        type: "gm_nft",
        multiplier: toSafeMultiplier(DEFAULT_ACHIEVEMENT_DEFINITIONS.gm_nft.base_multiplier),
        level: highestGmNft.level,
        name: highestGmNft.name,
      });
    }
  } catch (err) {
    console.warn("gm_nft_lookup_failed", { wallet: input.wallet, error: String(err) });
  }

  return {
    multiplier: computeAdditiveBonusMultiplier(sources.map((source) => source.multiplier)),
    sources,
  };
}

function normalizeBoolString(input: string): string {
  return input.trim().toLowerCase();
}

function getPostgresErrorCode(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const cause = (err as any).cause;
  if (!cause || typeof cause !== "object") return null;
  const code = (cause as any).code;
  return typeof code === "string" ? code : null;
}

function isUniqueViolation(err: unknown): boolean {
  return getPostgresErrorCode(err) === "23505";
}

const DAILY_SUCCESSFUL_RECEIPT_LIMIT = 1;
const DAILY_TOTAL_UPLOAD_LIMIT = 6;

function getUtcDayWindow(date = new Date()): { startIso: string; endIso: string } {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function isDailyLimitError(err: unknown, code?: string): boolean {
  if (!(err instanceof Error)) return false;
  const haystack = [
    err.message,
    typeof (err as any).cause === "object" && (err as any).cause
      ? JSON.stringify((err as any).cause)
      : "",
  ].join("\n");
  if (code) return haystack.includes(code);
  return (
    haystack.includes("daily_upload_limit_exceeded") ||
    haystack.includes("daily_verified_limit_exceeded")
  );
}

const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  // Some browsers (or file sources) omit the MIME type; our web client falls back to octet-stream.
  "application/octet-stream",
]);

// --- Scoring ---
type DifyDrinkItem = {
  retinfoDrinkCapacity?: unknown;
  retinfoDrinkAmount?: unknown;
};

const MAX_ITEMS = 25;
const MAX_AMOUNT = 20;
const MAX_TOTAL_POINTS = 20;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function parseCapacityMl(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    const v = Math.floor(input);
    return v > 0 ? v : null;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function parseAmount(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    const v = Math.floor(input);
    return clampInt(v, 1, MAX_AMOUNT);
  }
  if (typeof input === "string") {
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

// --- Rewards ---
const B3TR_DECIMALS = 18n;
const MAX_METADATA_SOURCE_ITEMS = 10;
const MAX_METADATA_DRINKS_PER_SOURCE = 3;
const DISTRIBUTE_REWARD_ABI = [
  "function distributeRewardWithProofAndMetadata(bytes32 appId,uint256 amount,address receiver,string[] proofTypes,string[] proofValues,string[] impactCodes,uint256[] impactValues,string description,string metadata)",
];
const REWARDS_POOL_BALANCE_ABI = [
  "function rewardsPoolBalance(bytes32 appId) view returns (uint256)",
];
const distributeIface = new Interface(DISTRIBUTE_REWARD_ABI);
const rewardsPoolBalanceIface = new Interface(REWARDS_POOL_BALANCE_ABI);

type RewardsQuote = {
  points_total: number;
  points_locked: number;
  points_available: number;
  points_per_b3tr: number;
  conversion_rate_id: string;
  b3tr_amount_wei: string;
  b3tr_amount: string;
};

type RewardsPoolStatus = {
  b3tr_available_funds_wei: string;
  b3tr_available_funds: string;
  rewards_pool_address: string;
  app_id: string;
  network: "testnet" | "mainnet";
  updated_at: string;
};

type SignRewardDistributionInput = {
  receiver: string;
  amountWei: bigint;
  claimId: string;
  description: string;
  proof: { text: string };
  impacts: { plastic: number };
  metadata: string;
};

type RewardsChain = {
  signRewardDistributionTx: (input: SignRewardDistributionInput) => Promise<{ txHash: string; rawTx: string }>;
  broadcastRawTransaction: (rawTx: string) => Promise<{ txHash: string }>;
  getTransactionReceipt: (txHash: string) => Promise<TransactionReceipt | null>;
  getRewardPoolBalance: () => Promise<{
    availableFundsWei: bigint;
    appId: string;
    rewardsPoolAddress: string;
    network: "testnet" | "mainnet";
  }>;
};

function computeClaimableB3trWei(input: { pointsAvailable: number; pointsPerB3tr: number }): bigint {
  if (!Number.isInteger(input.pointsAvailable) || input.pointsAvailable < 0) {
    throw new Error("points_available_invalid");
  }
  if (!Number.isInteger(input.pointsPerB3tr) || input.pointsPerB3tr <= 0) {
    throw new Error("points_per_b3tr_invalid");
  }
  if (input.pointsAvailable === 0) return 0n;
  return (BigInt(input.pointsAvailable) * 10n ** B3TR_DECIMALS) / BigInt(input.pointsPerB3tr);
}

function formatB3trDisplay(amountWei: bigint): string {
  if (amountWei < 0n) throw new Error("amount_invalid");
  return formatUnits(amountWei, 18);
}

function formatRewardClaimForApi(claim: DbRewardClaim) {
  return {
    id: claim.id,
    wallet_address: claim.wallet_address,
    client_claim_id: claim.client_claim_id,
    points_claimed: claim.points_claimed,
    points_per_b3tr_snapshot: claim.points_per_b3tr_snapshot,
    points_per_b3tr: claim.points_per_b3tr_snapshot,
    conversion_rate_id: claim.conversion_rate_id,
    b3tr_amount_wei: String(claim.b3tr_amount_wei),
    b3tr_amount: formatB3trDisplay(BigInt(String(claim.b3tr_amount_wei))),
    status: claim.status,
    tx_hash: claim.tx_hash,
    failure_reason: claim.failure_reason,
    created_at: claim.created_at,
    updated_at: claim.updated_at,
  };
}

async function getRewardsQuote(repo: ReturnType<typeof createRepo>, userId: string): Promise<RewardsQuote> {
  const [pointsTotal, pointsLocked, rate] = await Promise.all([
    repo.getUserPointsTotal(userId),
    repo.getUserPointsLocked(userId),
    repo.getActiveRewardConversionRate(),
  ]);
  if (!rate) throw new Error("rewards_unconfigured");
  const pointsAvailable = Math.max(0, pointsTotal - pointsLocked);
  const b3trWei = computeClaimableB3trWei({
    pointsAvailable,
    pointsPerB3tr: rate.points_per_b3tr,
  });
  return {
    points_total: pointsTotal,
    points_locked: pointsLocked,
    points_available: pointsAvailable,
    points_per_b3tr: rate.points_per_b3tr,
    conversion_rate_id: rate.id,
    b3tr_amount_wei: b3trWei.toString(),
    b3tr_amount: formatB3trDisplay(b3trWei),
  };
}

async function getRewardsPoolStatus(chain: RewardsChain): Promise<RewardsPoolStatus> {
  const balance = await chain.getRewardPoolBalance();
  return {
    b3tr_available_funds_wei: balance.availableFundsWei.toString(),
    b3tr_available_funds: formatB3trDisplay(balance.availableFundsWei),
    rewards_pool_address: balance.rewardsPoolAddress,
    app_id: balance.appId,
    network: balance.network,
    updated_at: new Date().toISOString(),
  };
}

function summarizeDrinkList(drinkList: unknown): {
  bottleCount: number;
  totalMl: number;
  drinks: Array<{ name: string | null; capacity_ml: number | null; amount: number }>;
} {
  const list = Array.isArray(drinkList) ? (drinkList as DifyDrinkItem[]).slice(0, MAX_ITEMS) : [];
  const drinks = list.map((item) => {
    const capacityMl = parseCapacityMl(item.retinfoDrinkCapacity);
    const amount = parseAmount(item.retinfoDrinkAmount);
    const rawName = isRecord(item) ? item.retinfoDrinkName : null;
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim().slice(0, 80) : null;
    return { name, capacity_ml: capacityMl, amount };
  });
  return {
    bottleCount: drinks.reduce((sum, item) => sum + item.amount, 0),
    totalMl: drinks.reduce((sum, item) => sum + (item.capacity_ml ?? 0) * item.amount, 0),
    drinks,
  };
}

function calculatePlasticReductionGrams(input: { bottleCount: number }): number {
  const baselineMl = 500;
  const u0 = 0.03;
  const k = 0.2;
  const bottleCount = Number.isFinite(input.bottleCount) ? Math.max(1, Math.floor(input.bottleCount)) : 1;
  const perMl = u0 / (1 + k * Math.log(bottleCount));
  const baselineTotal = u0 * bottleCount * baselineMl;
  const scaledTotal = perMl * bottleCount * baselineMl;
  return Number(Math.max(0, baselineTotal - scaledTotal).toFixed(3));
}

function selectSourcesForPoints(sources: DbReceiptSubmission[], pointsClaimed: number): DbReceiptSubmission[] {
  const selected: DbReceiptSubmission[] = [];
  let points = 0;
  for (const source of sources) {
    if (points >= pointsClaimed) break;
    if (source.points_total <= 0) continue;
    selected.push(source);
    points += source.points_total;
  }
  return selected;
}

function isBytes32Hex(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

function isPrivateKeyHex(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

function defaultVechainNodeUrl(network: "testnet" | "mainnet"): string {
  return network === "mainnet" ? "https://mainnet.vechain.org" : "https://testnet.vechain.org";
}

function requireRewardsPoolConfig(config: AppConfig) {
  const nodeUrl = config.VECHAIN_NODE_URL ?? defaultVechainNodeUrl(config.VECHAIN_NETWORK);
  if (!config.VEBETTER_APP_ID || !isBytes32Hex(config.VEBETTER_APP_ID)) throw new Error("rewards_unconfigured");
  if (!config.X2EARN_REWARDS_POOL_ADDRESS) throw new Error("rewards_unconfigured");
  return {
    nodeUrl,
    appId: config.VEBETTER_APP_ID,
    rewardsPoolAddress: getAddress(config.X2EARN_REWARDS_POOL_ADDRESS),
    network: config.VECHAIN_NETWORK,
  };
}

function requireRewardsChainConfig(config: AppConfig) {
  const poolConfig = requireRewardsPoolConfig(config);
  if (!config.FEE_DELEGATION_URL) throw new Error("rewards_unconfigured");
  if (!config.REWARD_DISTRIBUTOR_PRIVATE_KEY || !isPrivateKeyHex(config.REWARD_DISTRIBUTOR_PRIVATE_KEY)) {
    throw new Error("rewards_unconfigured");
  }
  return {
    ...poolConfig,
    feeDelegationUrl: config.FEE_DELEGATION_URL,
    distributorPrivateKey: config.REWARD_DISTRIBUTOR_PRIVATE_KEY,
  };
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function createRewardsChain(config: AppConfig): RewardsChain {
  if (config.REWARDS_MODE === "mock") {
    const mockAppId = isBytes32Hex(config.VEBETTER_APP_ID ?? "") ? config.VEBETTER_APP_ID! : `0x${"0".repeat(64)}`;
    const mockRewardsPoolAddress = config.X2EARN_REWARDS_POOL_ADDRESS
      ? getAddress(config.X2EARN_REWARDS_POOL_ADDRESS)
      : "0x0000000000000000000000000000000000000000";
    const mockRawTx = (claimId: string) => `0x${claimId.replace(/-/g, "")}`;
    return {
      async signRewardDistributionTx(input) {
        getAddress(input.receiver);
        if (input.amountWei <= 0n) throw new Error("amount_invalid");
        if (!input.proof.text.trim()) throw new Error("proof_invalid");
        if (!Number.isFinite(input.impacts.plastic) || input.impacts.plastic < 0) throw new Error("impact_invalid");
        JSON.parse(input.metadata);
        const rawTx = mockRawTx(input.claimId);
        return { rawTx, txHash: `0x${await sha256Hex(rawTx)}` };
      },
      async broadcastRawTransaction(rawTx) {
        return { txHash: `0x${await sha256Hex(rawTx)}` };
      },
      async getTransactionReceipt(txHash) {
        const now = Math.floor(Date.now() / 1000);
        return {
          gasUsed: 0,
          gasPayer: "0x0000000000000000000000000000000000000000",
          paid: "0",
          reward: "0",
          reverted: false,
          outputs: [],
          meta: {
            blockID: "0x" + "0".repeat(64),
            blockNumber: 1,
            blockTimestamp: now,
            txID: txHash,
            txOrigin: "0x0000000000000000000000000000000000000000",
          },
        };
      },
      async getRewardPoolBalance() {
        return {
          availableFundsWei: 1_000n * 10n ** 18n,
          appId: mockAppId,
          rewardsPoolAddress: mockRewardsPoolAddress,
          network: config.VECHAIN_NETWORK,
        };
      },
    };
  }

  let thorClient: ThorClient | null = null;
  let signerContext: any | null = null;

  function getThorClient(): ThorClient {
    if (thorClient) return thorClient;
    thorClient = ThorClient.at(config.VECHAIN_NODE_URL ?? defaultVechainNodeUrl(config.VECHAIN_NETWORK), {
      isPollingEnabled: false,
    });
    return thorClient;
  }

  async function createSignerContext() {
    const cfg = requireRewardsChainConfig(config);
    const pkBytes = getBytes(cfg.distributorPrivateKey);
    if (pkBytes.length !== 32) throw new Error("rewards_unconfigured");
    const signerAddress = Address.ofPrivateKey(pkBytes).toString();
    const wallet = new ProviderInternalBaseWallet(
      [{ address: signerAddress, privateKey: pkBytes }],
      { gasPayer: { gasPayerServiceUrl: cfg.feeDelegationUrl } },
    );
    const provider = new VeChainProvider(getThorClient(), wallet, true);
    const signer = await provider.getSigner(signerAddress);
    if (!signer) throw new Error("rewards_unconfigured");
    return { cfg, signer };
  }

  async function getSignerContext() {
    if (!signerContext) signerContext = await createSignerContext();
    return signerContext;
  }

  return {
    async signRewardDistributionTx(input) {
      const ctx = await getSignerContext();
      const receiver = getAddress(input.receiver);
      if (input.amountWei <= 0n) throw new Error("amount_invalid");
      const proofText = input.proof.text.trim();
      if (!proofText) throw new Error("proof_invalid");
      if (!Number.isFinite(input.impacts.plastic) || input.impacts.plastic < 0) throw new Error("impact_invalid");
      JSON.parse(input.metadata);
      const plasticImpact = Math.max(0, Math.floor(input.impacts.plastic));
      const data = distributeIface.encodeFunctionData("distributeRewardWithProofAndMetadata", [
        ctx.cfg.appId,
        input.amountWei,
        receiver,
        ["text"],
        [proofText],
        ["plastic"],
        [plasticImpact],
        input.description,
        input.metadata,
      ]);
      const rawTx = await ctx.signer.signTransaction({
        to: ctx.cfg.rewardsPoolAddress,
        data,
        value: 0,
        comment: `BigBottle claim ${input.claimId}`,
      });
      const txHash = Transaction.decode(getBytes(rawTx), true).getTransactionHash().toString();
      return { txHash, rawTx };
    },
    async broadcastRawTransaction(rawTx) {
      const res = await getThorClient().transactions.sendRawTransaction(rawTx);
      return { txHash: res.id };
    },
    async getTransactionReceipt(txHash) {
      return await getThorClient().transactions.getTransactionReceipt(txHash);
    },
    async getRewardPoolBalance() {
      const cfg = requireRewardsPoolConfig(config);
      const data = rewardsPoolBalanceIface.encodeFunctionData("rewardsPoolBalance", [cfg.appId]);
      const res = await fetch(`${cfg.nodeUrl}/accounts/*`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clauses: [{ to: cfg.rewardsPoolAddress, data, value: "0x0" }],
          caller: "0x0000000000000000000000000000000000000000",
        }),
      });
      if (!res.ok) throw new Error(`rewards_pool_balance_failed:${res.status}`);
      const payload = (await res.json()) as Array<{ data?: string; reverted?: boolean; vmError?: string }>;
      const output = payload?.[0]?.data;
      if (payload?.[0]?.reverted || !output || output === "0x") {
        throw new Error(payload?.[0]?.vmError ?? "rewards_pool_balance_failed");
      }
      const decoded = rewardsPoolBalanceIface.decodeFunctionResult("rewardsPoolBalance", output)[0] as bigint;
      return {
        availableFundsWei: decoded,
        appId: cfg.appId,
        rewardsPoolAddress: cfg.rewardsPoolAddress,
        network: cfg.network,
      };
    },
  };
}

async function refreshRewardClaimStatus(
  repo: ReturnType<typeof createRepo>,
  chain: RewardsChain,
  claim: DbRewardClaim,
): Promise<DbRewardClaim> {
  if (claim.status !== "submitted" || !claim.tx_hash) return claim;
  const receipt = await chain.getTransactionReceipt(claim.tx_hash);
  if (!receipt) return claim;
  if (receipt.reverted) {
    return await repo.updateRewardClaim(claim.id, {
      status: "failed",
      failure_reason: "tx_reverted",
    });
  }
  return await repo.updateRewardClaim(claim.id, {
    status: "confirmed",
    failure_reason: null,
  });
}

async function createOrGetRewardClaimAndSubmit(input: {
  repo: ReturnType<typeof createRepo>;
  chain: RewardsChain;
  userId: string;
  walletAddressLower: string;
  clientClaimId: string;
}): Promise<DbRewardClaim> {
  const { repo, chain, userId, walletAddressLower, clientClaimId } = input;
  const existing = await repo.getRewardClaimByClientId({ user_id: userId, client_claim_id: clientClaimId });
  if (existing) return existing;
  const inflight = await repo.getInflightRewardClaim(userId);
  if (inflight) return inflight;

  const quote = await getRewardsQuote(repo, userId);
  if (quote.points_available <= 0) throw new Error("no_claimable_points");
  const amountWei = BigInt(quote.b3tr_amount_wei);
  if (amountWei <= 0n) throw new Error("no_claimable_amount");

  let claim: DbRewardClaim;
  try {
    claim = await repo.createRewardClaim({
      user_id: userId,
      wallet_address: walletAddressLower,
      client_claim_id: clientClaimId,
      conversion_rate_id: quote.conversion_rate_id,
      points_per_b3tr_snapshot: quote.points_per_b3tr,
      points_claimed: quote.points_available,
      b3tr_amount_wei: amountWei.toString(),
      status: "pending",
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const byClientId = await repo.getRewardClaimByClientId({ user_id: userId, client_claim_id: clientClaimId });
      if (byClientId) return byClientId;
      const byInflight = await repo.getInflightRewardClaim(userId);
      if (byInflight) return byInflight;
    }
    throw err;
  }

  try {
    const sourceCandidates = await repo.listRewardClaimSourceSubmissions(userId);
    const selectedSources = selectSourcesForPoints(sourceCandidates, claim.points_claimed);
    const selectedPoints = selectedSources.reduce((sum, source) => sum + source.points_total, 0);
    if (selectedSources.length === 0 || selectedPoints !== claim.points_claimed) {
      throw new Error("no_claimable_sources");
    }

    await repo.createRewardClaimSources(
      selectedSources.map((source) => ({
        claim_id: claim.id,
        submission_id: source.id,
        points_total: source.points_total,
        receipt_fingerprint: source.receipt_fingerprint,
        dify_drink_list: source.dify_drink_list,
      })),
    );

    const sourceSummaries = selectedSources.map((source) => {
      const summary = summarizeDrinkList(source.dify_drink_list);
      return {
        submission_id: source.id,
        receipt_fingerprint: source.receipt_fingerprint,
        points: source.points_total,
        verified_at: source.verified_at,
        bottle_count: summary.bottleCount,
        total_ml: summary.totalMl,
        drinks: summary.drinks.slice(0, MAX_METADATA_DRINKS_PER_SOURCE),
      };
    });
    const bottleCount = sourceSummaries.reduce((sum, source) => sum + source.bottle_count, 0);
    const totalMl = sourceSummaries.reduce((sum, source) => sum + source.total_ml, 0);
    const plasticReductionGrams = Math.round(calculatePlasticReductionGrams({ bottleCount: Math.max(1, bottleCount) }));
    const proofText = `BigBottle verified ${selectedSources.length} receipt(s), ${bottleCount} bottle(s), ${totalMl} ml total.`;
    const metadata = JSON.stringify({
      schema: "bigbottle.reward_claim.v1",
      claim: {
        claim_id: claim.id,
        points_claimed: claim.points_claimed,
        points_per_b3tr: claim.points_per_b3tr_snapshot,
        b3tr_amount_wei: claim.b3tr_amount_wei,
        conversion_rate_id: claim.conversion_rate_id,
      },
      impact_model: {
        code: "bigbottle-plastic-v1",
        baseline_ml: 500,
        plastic_unit: "grams",
      },
      sources: {
        submission_count: selectedSources.length,
        bottle_count: bottleCount,
        total_ml: totalMl,
        items_truncated: sourceSummaries.length > MAX_METADATA_SOURCE_ITEMS,
        items: sourceSummaries.slice(0, MAX_METADATA_SOURCE_ITEMS),
      },
    });

    const { txHash, rawTx } = await chain.signRewardDistributionTx({
      receiver: walletAddressLower,
      amountWei,
      claimId: claim.id,
      description: "BigBottle receipt verified recycling reward",
      proof: { text: proofText },
      impacts: { plastic: plasticReductionGrams },
      metadata,
    });

    let submitted = await repo.updateRewardClaim(claim.id, {
      status: "submitted",
      tx_hash: txHash,
      raw_tx: rawTx,
      failure_reason: null,
    });

    try {
      const sent = await chain.broadcastRawTransaction(rawTx);
      if (sent.txHash && sent.txHash !== submitted.tx_hash) {
        submitted = await repo.updateRewardClaim(claim.id, { tx_hash: sent.txHash });
      }
    } catch {
      // Raw tx is persisted and can be re-sent.
    }

    return submitted;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await repo.updateRewardClaim(claim.id, { status: "failed", failure_reason: reason });
    } catch {
      // Points may remain locked until manual intervention.
    }
    throw err;
  }
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
  if (config.DIFY_MODE === "mock") {
    return {
      drinkList: [
        {
          retinfoDrinkName: "MOCK_WATER",
          retinfoDrinkCapacity: 500,
          retinfoDrinkAmount: 1,
        },
      ],
      retinfoIsAvaild: "true",
      retinfoReceiptTime: "2026-02-04 08:52:00",
      timeThreshold: "true",
      user_id: input.userRef,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.DIFY_TIMEOUT_MS);

  const url = new URL("/v1/workflows/run", config.DIFY_API_URL);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.DIFY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workflow_id: config.DIFY_WORKFLOW_ID,
        inputs: {
          // Dify workflow input is configured as a file input. We pass a remote URL so Dify can fetch it.
          [config.DIFY_IMAGE_INPUT_KEY]: {
            type: "image",
            transfer_method: "remote_url",
            url: input.imageUrl,
          },
        },
        response_mode: "blocking",
        user: input.userRef,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dify request failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json();
}

function extractDifyReceiptPayload(raw: unknown): DifyReceiptPayload | null {
  const candidates: unknown[] = [];

  if (typeof raw === "string") {
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
    if ("drinkList" in direct || "retinfoIsAvaild" in direct || "timeThreshold" in direct) {
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
    params.region === "us-east-1"
      ? `${params.bucket}.s3.amazonaws.com`
      : `${params.bucket}.s3.${params.region}.amazonaws.com`;
  const encodedKey = params.key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return new URL(`https://${host}/${encodedKey}`);
}

function createS3Client(config: AppConfig): AwsClient {
  return new AwsClient({
    service: "s3",
    region: config.AWS_REGION,
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    sessionToken: config.AWS_SESSION_TOKEN,
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
  url.searchParams.set("X-Amz-Expires", String(params.expiresInSeconds));

  // For simplicity and compatibility across clients, we do not sign Content-Type.
  // The caller can still pass it in the upload headers.
  const signed = await params.s3.sign(url, {
    method: "PUT",
    aws: { signQuery: true },
  });

  const headers: Record<string, string> = { "Content-Type": params.contentType };
  if (params.cacheControl) headers["Cache-Control"] = params.cacheControl;
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
  url.searchParams.set("X-Amz-Expires", String(params.expiresInSeconds));

  const signed = await params.s3.sign(url, {
    method: "GET",
    aws: { signQuery: true },
  });
  return { url: signed.url };
}

async function headObject(params: {
  s3: AwsClient;
  region: string;
  bucket: string;
  key: string;
}): Promise<{
  contentLength: number | null;
  contentType: string | null;
  eTag: string | null;
} | null> {
  const url = s3ObjectUrl({ region: params.region, bucket: params.bucket, key: params.key });
  const res = await params.s3.fetch(url, { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`S3 head failed: ${res.status} ${res.statusText}`);

  const contentLengthRaw = res.headers.get("content-length");
  const contentLength = contentLengthRaw ? Number.parseInt(contentLengthRaw, 10) : NaN;

  return {
    contentLength: Number.isFinite(contentLength) ? contentLength : null,
    contentType: res.headers.get("content-type"),
    eTag: res.headers.get("etag"),
  };
}

async function deleteObject(params: {
  s3: AwsClient;
  region: string;
  bucket: string;
  key: string;
}): Promise<void> {
  const url = s3ObjectUrl({ region: params.region, bucket: params.bucket, key: params.key });
  const res = await params.s3.fetch(url, { method: "DELETE" });
  // DeleteObject is idempotent, but we still treat 404 as success for robustness.
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`S3 delete failed: ${res.status} ${res.statusText}`);
}

const handleRequest: (config: AppConfig) => HttpHandler = (config) => async (req, ctx) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(config, req) });
  }

  if (req.method === "GET" && ctx.routePath === "/health") {
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

  let rewardsChain: RewardsChain | null = null;
  const getRewardsChain = (): RewardsChain => {
    if (!rewardsChain) rewardsChain = createRewardsChain(config);
    return rewardsChain;
  };

  if (req.method === "GET" && ctx.routePath === "/health/s3") {
    const s3 = getS3();
    const key = `uploads/healthchecks/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.txt`;
    const url = s3ObjectUrl({ region: config.AWS_REGION, bucket: config.S3_BUCKET, key });

    try {
      const put = await s3.fetch(url, {
        method: "PUT",
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: "ok",
      });

      const head = await s3.fetch(url, { method: "HEAD" });
      const del = await s3.fetch(url, { method: "DELETE" });

      return jsonResponse(config, req, 200, {
        ok: put.ok && head.ok && del.ok,
        bucket: config.S3_BUCKET,
        key,
        put: { status: put.status, ok: put.ok },
        head: { status: head.status, ok: head.ok },
        del: { status: del.status, ok: del.ok },
      });
    } catch (err) {
      return jsonResponse(config, req, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        bucket: config.S3_BUCKET,
        key,
      });
    }
  }

  // --- Auth ---
  if (req.method === "POST" && ctx.routePath === "/auth/challenge") {
    const body = await readJson(req);
    if (!isRecord(body)) return errorResponse(config, req, 400, "invalid_body");
    const address = typeof body.address === "string" ? body.address : "";
    if (!address) return errorResponse(config, req, 400, "invalid_body");

    const wallet = normalizeWalletAddress(address);
    if (!wallet) return errorResponse(config, req, 400, "invalid_address");

    const challengeId = crypto.randomUUID();
    const nonce = randomHex(16);
    const expiresAtIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await getRepo().createAuthChallenge({
      id: challengeId,
      wallet_address: wallet.lower,
      nonce,
      expires_at: expiresAtIso,
    });

    const typedData = buildLoginTypedData({
      walletAddress: wallet.lower,
      challengeId,
      nonce,
    });

    return jsonResponse(config, req, 200, {
      challenge_id: challengeId,
      typed_data: typedData,
    });
  }

  if (req.method === "POST" && ctx.routePath === "/auth/verify") {
    const body = await readJson(req);
    if (!isRecord(body)) return errorResponse(config, req, 400, "invalid_body");
    const challengeId = parseUuid(body.challenge_id);
    const signature = typeof body.signature === "string" ? body.signature.trim() : "";
    if (!challengeId || !signature) return errorResponse(config, req, 400, "invalid_body");

    const challenge = await getRepo().getAuthChallenge(challengeId);
    if (!challenge) return errorResponse(config, req, 401, "invalid_challenge");
    if (challenge.used_at) return errorResponse(config, req, 401, "challenge_used");
    if (Date.parse(challenge.expires_at) <= Date.now())
      return errorResponse(config, req, 401, "challenge_expired");

    const ok = verifyLoginSignature({
      walletAddress: challenge.wallet_address,
      challengeId: challenge.id,
      nonce: challenge.nonce,
      signature,
    });
    if (!ok) return errorResponse(config, req, 401, "invalid_signature");

    const claimed = await getRepo().markAuthChallengeUsed(challenge.id);
    if (!claimed) return errorResponse(config, req, 401, "challenge_used");

    const user = await getRepo().getOrCreateUser(challenge.wallet_address);
    const token = await signAccessToken(config, { sub: user.id, wallet: user.wallet_address });

    return jsonResponse(config, req, 200, {
      access_token: token,
      user: { id: user.id, wallet_address: user.wallet_address, created_at: user.created_at },
    });
  }

  if (req.method === "GET" && ctx.routePath === "/me") {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");

    const user = await getRepo().getOrCreateUser(authed.wallet);
    if (user.id !== authed.sub) {
      // Not fatal in Phase 1, but useful for debugging.
      console.warn("token_user_id_mismatch", { tokenUserId: authed.sub, dbUserId: user.id });
    }

    return jsonResponse(config, req, 200, { user });
  }

  // --- Account ---
  if (req.method === "GET" && ctx.routePath === "/account/summary") {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");

    const pointsTotal = await getRepo().getUserPointsTotal(authed.sub);
    return jsonResponse(config, req, 200, { summary: { points_total: pointsTotal, level: null } });
  }

  if (req.method === "GET" && ctx.routePath === "/account/achievements") {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");

    const wallet = authed.wallet;
    const repo = getRepo();
    const url = new URL(req.url);
    const effectiveRoundIdRaw = url.searchParams.get("effective_round_id");
    const effectiveRoundId =
      effectiveRoundIdRaw === null ? undefined : Number(effectiveRoundIdRaw);
    if (
      effectiveRoundIdRaw !== null &&
      (!Number.isInteger(effectiveRoundId) || effectiveRoundId <= 0)
    ) {
      return errorResponse(config, req, 400, "invalid_query");
    }
    const targetEffectiveRoundId = effectiveRoundId ?? config.VEBETTER_CURRENT_EFFECTIVE_ROUND_ID;

    let definitions = Object.values(DEFAULT_ACHIEVEMENT_DEFINITIONS)
      .filter((item) => item.enabled)
      .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
    try {
      definitions = resolveAchievementDefinitions(
        await repo.listAchievementDefinitions(Object.keys(DEFAULT_ACHIEVEMENT_DEFINITIONS)),
      );
    } catch (err) {
      console.warn("achievement_definition_load_failed", { error: String(err) });
    }

    let vebetterVote: DbVoteBonusEligibility | null = null;
    try {
      vebetterVote = await repo.getLatestUserBonusEligibility({
        user_id: authed.sub,
        wallet_address: wallet,
        bonus_type: "vebetter_vote_bonus",
        ...(targetEffectiveRoundId === undefined ? {} : { effective_round_id: targetEffectiveRoundId }),
      });
    } catch (err) {
      console.warn("vote_bonus_lookup_failed", { wallet, userId: authed.sub, error: String(err) });
    }

    let highestGmNft: { level: number; name: string } | null = null;
    try {
      highestGmNft = await getHighestGmNftByOwner(config, wallet);
    } catch (err) {
      console.warn("gm_nft_lookup_failed", { wallet, error: String(err) });
    }

    const achievements = definitions.map((definition) => {
      if (definition.key === "vebetter_vote_bonus") {
        const unlocked = Boolean(vebetterVote);
        const multiplier = unlocked
          ? resolveBonusMultiplier(vebetterVote?.bonus_multiplier, definition.base_multiplier)
          : 1;
        const description = unlocked
          ? renderTemplate(definition.unlocked_description_template, {
              multiplier,
              effective_round_id: vebetterVote?.effective_round_id ?? null,
              source_round_id: vebetterVote?.source_round_id ?? null,
            })
          : definition.locked_description;
        const tagLabel = unlocked
          ? renderTemplate(definition.unlocked_tag_label_template ?? definition.title, {
              multiplier,
              effective_round_id: vebetterVote?.effective_round_id ?? null,
            })
          : (definition.locked_tag_label ?? definition.title);

        return {
          key: definition.key,
          title: definition.title,
          description,
          badge: definition.badge,
          tag_label: tagLabel,
          unlocked,
          multiplier,
          status: unlocked ? (vebetterVote?.status ?? "eligible") : "locked",
          effective_round_id: unlocked ? (vebetterVote?.effective_round_id ?? null) : null,
          source_round_id: unlocked ? (vebetterVote?.source_round_id ?? null) : null,
          node_name: null,
          node_level: null,
        };
      }

      if (definition.key === "gm_nft") {
        const unlocked = Boolean(highestGmNft);
        const gmLevel = highestGmNft?.level ?? null;
        const gmName = resolveConfiguredLevelName(definition, gmLevel, highestGmNft?.name ?? null);
        const multiplier = unlocked ? definition.base_multiplier : 1;
        const description = unlocked
          ? renderTemplate(definition.unlocked_description_template, {
              level: gmLevel,
              level_name: gmName,
              multiplier,
            })
          : definition.locked_description;
        const tagLabel = unlocked
          ? renderTemplate(definition.unlocked_tag_label_template ?? definition.title, {
              level: gmLevel,
              level_name: gmName,
            })
          : (definition.locked_tag_label ?? definition.title);

        return {
          key: definition.key,
          title: definition.title,
          description,
          badge: definition.badge,
          tag_label: tagLabel,
          unlocked,
          multiplier,
          status: unlocked ? "eligible" : "locked",
          effective_round_id: null,
          source_round_id: null,
          node_name: gmName,
          node_level: gmLevel,
        };
      }

      return {
        key: definition.key,
        title: definition.title,
        description: definition.locked_description,
        badge: definition.badge,
        tag_label: definition.locked_tag_label ?? definition.title,
        unlocked: false,
        multiplier: 1,
        status: "locked",
        effective_round_id: null,
        source_round_id: null,
        node_name: null,
        node_level: null,
      };
    });

    const unlockedCount = achievements.filter((a) => a.unlocked).length;
    const totalMultiplier = computeAchievementTotalMultiplier(achievements);

    return jsonResponse(config, req, 200, {
      achievements,
      summary: {
        unlocked_count: unlockedCount,
        total_count: achievements.length,
        total_multiplier: Number(totalMultiplier.toFixed(4)),
      },
    });
  }

  // --- Rewards ---
  if (req.method === "GET" && ctx.routePath === "/rewards/pool") {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");
    try {
      const pool = await getRewardsPoolStatus(getRewardsChain());
      return jsonResponse(config, req, 200, { pool });
    } catch (err) {
      const code = err instanceof Error ? err.message : null;
      if (code === "rewards_unconfigured") return errorResponse(config, req, 503, "rewards_unconfigured");
      console.error("rewards_pool_failed", err);
      return errorResponse(config, req, 500, "internal_error");
    }
  }

  if (req.method === "GET" && ctx.routePath === "/rewards/quote") {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");
    try {
      const quote = await getRewardsQuote(getRepo(), authed.sub);
      return jsonResponse(config, req, 200, { quote });
    } catch (err) {
      const code = err instanceof Error ? err.message : null;
      if (code === "rewards_unconfigured") return errorResponse(config, req, 503, "rewards_unconfigured");
      console.error("rewards_quote_failed", err);
      return errorResponse(config, req, 500, "internal_error");
    }
  }

  if (req.method === "POST" && ctx.routePath === "/rewards/claim") {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");
    const body = await readJson(req);
    if (!isRecord(body)) return errorResponse(config, req, 400, "invalid_body");
    const clientClaimId = parseUuid(body.client_claim_id);
    if (!clientClaimId) return errorResponse(config, req, 400, "invalid_body");

    try {
      const claim = await createOrGetRewardClaimAndSubmit({
        repo: getRepo(),
        chain: getRewardsChain(),
        userId: authed.sub,
        walletAddressLower: authed.wallet,
        clientClaimId,
      });
      return jsonResponse(config, req, 200, { claim: formatRewardClaimForApi(claim) });
    } catch (err) {
      const code = err instanceof Error ? err.message : null;
      if (code === "rewards_unconfigured") return errorResponse(config, req, 503, "rewards_unconfigured");
      if (
        code === "no_claimable_points" ||
        code === "no_claimable_amount" ||
        code === "no_claimable_sources" ||
        code === "amount_invalid"
      ) {
        return errorResponse(config, req, 400, code);
      }
      if (isUniqueViolation(err)) return errorResponse(config, req, 409, "claim_conflict");
      console.error("rewards_claim_failed", err);
      return errorResponse(config, req, 500, "internal_error");
    }
  }

  if (req.method === "GET" && ctx.routePath === "/rewards/claims") {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");
    const url = new URL(req.url);
    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;
    const claims = await getRepo().listRewardClaims(authed.sub, limit);
    return jsonResponse(config, req, 200, { claims: claims.map(formatRewardClaimForApi) });
  }

  const rewardClaimMatch = ctx.routePath.match(/^\/rewards\/claims\/([^/]+)$/);
  if (req.method === "GET" && rewardClaimMatch) {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");
    const claimId = parseUuid(rewardClaimMatch[1]);
    if (!claimId) return errorResponse(config, req, 400, "invalid_params");
    const claim = await getRepo().getRewardClaimById(claimId);
    if (!claim || claim.user_id !== authed.sub) return errorResponse(config, req, 404, "not_found");
    try {
      const refreshed = await refreshRewardClaimStatus(getRepo(), getRewardsChain(), claim);
      return jsonResponse(config, req, 200, { claim: formatRewardClaimForApi(refreshed) });
    } catch (err) {
      console.warn("rewards_claim_refresh_failed", { claimId: claim.id, txHash: claim.tx_hash, error: String(err) });
      return jsonResponse(config, req, 200, { claim: formatRewardClaimForApi(claim) });
    }
  }

  // --- Submissions ---
  if (req.method === "POST" && ctx.routePath === "/submissions/init") {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");

    const repo = getRepo();
    const s3 = getS3();

    const body = await readJson(req);
    if (!isRecord(body)) return errorResponse(config, req, 400, "invalid_body");
    const clientSubmissionId = parseUuid(body.client_submission_id);
    const contentTypeRaw = typeof body.content_type === "string" ? body.content_type : "";
    if (!clientSubmissionId || !contentTypeRaw)
      return errorResponse(config, req, 400, "invalid_body");

    const existing = await repo.getSubmissionByClientId({
      user_id: authed.sub,
      client_submission_id: clientSubmissionId,
    });
    if (existing) {
      if (existing.status === "pending_upload") {
        const existingContentType = (
          existing.image_content_type || "application/octet-stream"
        ).toLowerCase();
        const upload = await presignPutObject({
          s3,
          region: config.AWS_REGION,
          bucket: existing.image_bucket,
          key: existing.image_key,
          contentType: existingContentType,
          expiresInSeconds: config.S3_PRESIGN_EXPIRES_SECONDS,
        });
        return jsonResponse(config, req, 200, {
          submission: existing,
          upload: { method: "PUT", ...upload },
        });
      }
      return jsonResponse(config, req, 200, { submission: existing, upload: null });
    }

    const today = getUtcDayWindow();
    const [dailyUploadCount, dailyVerifiedCount] = await Promise.all([
      repo.countSubmissionsCreatedInWindow({
        user_id: authed.sub,
        start_iso: today.startIso,
        end_iso: today.endIso,
      }),
      repo.countVerifiedSubmissionsCreatedInWindow({
        user_id: authed.sub,
        start_iso: today.startIso,
        end_iso: today.endIso,
      }),
    ]);
    if (dailyVerifiedCount >= DAILY_SUCCESSFUL_RECEIPT_LIMIT) {
      return errorResponse(config, req, 429, "daily_verified_limit_exceeded");
    }
    if (dailyUploadCount >= DAILY_TOTAL_UPLOAD_LIMIT) {
      return errorResponse(config, req, 429, "daily_upload_limit_exceeded");
    }

    const contentType = contentTypeRaw.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(contentType)) {
      return errorResponse(config, req, 400, "unsupported_content_type");
    }

    const ext =
      contentType === "image/png"
        ? "png"
        : contentType === "image/jpeg"
          ? "jpg"
          : contentType === "image/webp"
            ? "webp"
            : contentType === "image/heic" || contentType === "image/heif"
              ? "heic"
              : "bin";

    const submissionId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const month = nowIso.slice(0, 7);
    const day = nowIso.slice(0, 10);
    const imageKey = `uploads/${month}/${day}/${submissionId}.${ext}`;

    let created: DbReceiptSubmission;
    try {
      created = await repo.createSubmission({
        id: submissionId,
        user_id: authed.sub,
        client_submission_id: clientSubmissionId,
        status: "pending_upload",
        image_bucket: config.S3_BUCKET,
        image_key: imageKey,
        image_content_type: contentType,
      });
    } catch (err) {
      console.warn("create_submission_failed", err);
      const again = await repo.getSubmissionByClientId({
        user_id: authed.sub,
        client_submission_id: clientSubmissionId,
      });
      if (again) {
        if (again.status === "pending_upload") {
          const upload = await presignPutObject({
            s3,
            region: config.AWS_REGION,
            bucket: again.image_bucket,
            key: again.image_key,
            contentType: (again.image_content_type || contentType).toLowerCase(),
            expiresInSeconds: config.S3_PRESIGN_EXPIRES_SECONDS,
          });
          return jsonResponse(config, req, 200, {
            submission: again,
            upload: { method: "PUT", ...upload },
          });
        }
        return jsonResponse(config, req, 200, { submission: again, upload: null });
      }
      if (isDailyLimitError(err, "daily_upload_limit_exceeded")) {
        return errorResponse(config, req, 429, "daily_upload_limit_exceeded");
      }
      throw err;
    }

    const upload = await presignPutObject({
      s3,
      region: config.AWS_REGION,
      bucket: created.image_bucket,
      key: created.image_key,
      contentType: (created.image_content_type || contentType).toLowerCase(),
      expiresInSeconds: config.S3_PRESIGN_EXPIRES_SECONDS,
    });

    return jsonResponse(config, req, 200, {
      submission: created,
      upload: { method: "PUT", ...upload },
    });
  }

  const completeMatch = ctx.routePath.match(/^\/submissions\/([^/]+)\/complete$/);
  if (req.method === "POST" && completeMatch) {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");
    const submissionId = parseUuid(completeMatch[1]);
    if (!submissionId) return errorResponse(config, req, 400, "invalid_params");

    const repo = getRepo();
    const s3 = getS3();

    const submission = await repo.getSubmissionById(submissionId);
    if (!submission || submission.user_id !== authed.sub)
      return errorResponse(config, req, 404, "not_found");

    if (submission.status === "pending_upload") {
      const meta = await headObject({
        s3,
        region: config.AWS_REGION,
        bucket: submission.image_bucket,
        key: submission.image_key,
      });
      if (!meta) return errorResponse(config, req, 409, "upload_not_found");

      const updated =
        (await repo.updateSubmissionStatusIfCurrent({
          id: submission.id,
          from: "pending_upload",
          to: "uploaded",
        })) ?? submission;
      return jsonResponse(config, req, 200, { submission: updated });
    }

    return jsonResponse(config, req, 200, { submission });
  }

  const verifyMatch = ctx.routePath.match(/^\/submissions\/([^/]+)\/verify$/);
  if (req.method === "POST" && verifyMatch) {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");
    const submissionId = parseUuid(verifyMatch[1]);
    if (!submissionId) return errorResponse(config, req, 400, "invalid_params");

    const repo = getRepo();
    const s3 = getS3();

    const verifyStart = performance.now();
    const timing: Record<string, number | null> = {
      db_get_ms: null,
      db_claim_ms: null,
      s3_head_ms: null,
      s3_presign_get_ms: null,
      dify_ms: null,
      payload_extract_ms: null,
      fingerprint_ms: null,
      db_update_ms: null,
      s3_delete_ms: null,
      total_ms: null,
    };

    const tDbGet = performance.now();
    const submission = await repo.getSubmissionById(submissionId);
    timing.db_get_ms = Math.round(performance.now() - tDbGet);
    if (!submission || submission.user_id !== authed.sub)
      return errorResponse(config, req, 404, "not_found");

    if (["verified", "rejected", "not_claimable"].includes(submission.status)) {
      return jsonResponse(config, req, 200, { submission });
    }
    if (submission.status === "pending_upload") {
      return errorResponse(config, req, 409, "upload_incomplete");
    }
    const uploadDay = getUtcDayWindow(new Date(submission.created_at));
    const dailyVerifiedCount = await repo.countVerifiedSubmissionsCreatedInWindow({
      user_id: authed.sub,
      start_iso: uploadDay.startIso,
      end_iso: uploadDay.endIso,
    });
    if (dailyVerifiedCount >= DAILY_SUCCESSFUL_RECEIPT_LIMIT) {
      return errorResponse(config, req, 429, "daily_verified_limit_exceeded");
    }
    if (submission.status === "verifying") {
      return jsonResponse(config, req, 200, { submission });
    }

    const tDbClaim = performance.now();
    const claimed = await repo.updateSubmissionStatusIfCurrent({
      id: submission.id,
      from: "uploaded",
      to: "verifying",
    });
    timing.db_claim_ms = Math.round(performance.now() - tDbClaim);
    if (!claimed) {
      const fresh = await repo.getSubmissionById(submission.id);
      if (!fresh || fresh.user_id !== authed.sub)
        return errorResponse(config, req, 404, "not_found");
      return jsonResponse(config, req, 200, { submission: fresh });
    }

    const verifyInBackground = async () => {
      let updatedForLog: DbReceiptSubmission | null = null;
      let imageBytesForLog: number | null = null;
      let errorForLog: { message: string; code: string | null } | null = null;

      try {
      const tHead = performance.now();
      const meta = await headObject({
        s3,
        region: config.AWS_REGION,
        bucket: claimed.image_bucket,
        key: claimed.image_key,
      });
      timing.s3_head_ms = Math.round(performance.now() - tHead);
      if (!meta) {
        updatedForLog = await repo.updateSubmission(claimed.id, { status: "pending_upload" });
        return;
      }
      imageBytesForLog = meta.contentLength;

      const tPresignGet = performance.now();
      const getUrl = await presignGetObject({
        s3,
        region: config.AWS_REGION,
        bucket: claimed.image_bucket,
        key: claimed.image_key,
        expiresInSeconds: Math.max(60, config.S3_PRESIGN_EXPIRES_SECONDS),
      });
      timing.s3_presign_get_ms = Math.round(performance.now() - tPresignGet);

      const tDify = performance.now();
      const difyRaw = await runDify(config, { imageUrl: getUrl.url, userRef: authed.wallet });
      timing.dify_ms = Math.round(performance.now() - tDify);

      const tExtract = performance.now();
      const payload = extractDifyReceiptPayload(difyRaw);
      timing.payload_extract_ms = Math.round(performance.now() - tExtract);

      if (!payload) {
        const tDbUpdate = performance.now();
        const updated = await repo.updateSubmission(claimed.id, {
          status: "rejected",
          dify_raw: difyRaw as any,
          points_base: 0,
          points_multiplier: 1,
          points_bonus_sources: [],
          points_total: 0,
          verified_at: new Date().toISOString(),
        });
        timing.db_update_ms = Math.round(performance.now() - tDbUpdate);
        try {
          const tDelete = performance.now();
          await deleteObject({
            s3,
            region: config.AWS_REGION,
            bucket: claimed.image_bucket,
            key: claimed.image_key,
          });
          timing.s3_delete_ms = Math.round(performance.now() - tDelete);
        } catch (deleteErr) {
          console.warn("s3_delete_rejected_image_failed", {
            bucket: claimed.image_bucket,
            key: claimed.image_key,
            message: deleteErr instanceof Error ? deleteErr.message : String(deleteErr),
          });
        }
        updatedForLog = updated;
        return;
      }

      if (typeof payload.user_id === "string") {
        const difyUser = payload.user_id.trim();
        if (difyUser && difyUser !== authed.wallet) {
          console.warn("dify_user_id_mismatch_ignored", { difyUser, wallet: authed.wallet });
        }
      }

      const nowIso = new Date().toISOString();
      const retinfoIsAvaildRaw =
        typeof payload.retinfoIsAvaild === "string"
          ? payload.retinfoIsAvaild
          : String(payload.retinfoIsAvaild ?? "");
      const timeThresholdRaw =
        typeof payload.timeThreshold === "string"
          ? payload.timeThreshold
          : String(payload.timeThreshold ?? "");
      const receiptTimeRaw =
        typeof payload.retinfoReceiptTime === "string"
          ? payload.retinfoReceiptTime
          : payload.retinfoReceiptTime == null
            ? null
            : String(payload.retinfoReceiptTime);

      const retinfoIsAvaild = normalizeBoolString(retinfoIsAvaildRaw);
      const timeThreshold = normalizeBoolString(timeThresholdRaw);

      const ok = retinfoIsAvaild === "true" && timeThreshold === "true";
      const { totalPoints: basePoints } = computeTotalPoints(payload.drinkList);
      const bonusSnapshot =
        ok && basePoints > 0
          ? await getReceiptBonusSnapshot({
              config,
              repo,
              userId: authed.sub,
              wallet: authed.wallet,
              ...(config.VEBETTER_CURRENT_EFFECTIVE_ROUND_ID === undefined
                ? {}
                : { effectiveRoundId: config.VEBETTER_CURRENT_EFFECTIVE_ROUND_ID }),
            })
          : EMPTY_RECEIPT_BONUS_SNAPSHOT;
      const earnedBasePoints = ok ? basePoints : 0;
      const totalPoints = ok ? applyPointsMultiplier(earnedBasePoints, bonusSnapshot.multiplier) : 0;
      const finalStatus = ok ? (totalPoints > 0 ? "verified" : "not_claimable") : "rejected";

      const tFingerprint = performance.now();
      const receiptFingerprint =
        finalStatus === "verified"
          ? await repo.computeReceiptFingerprint({
              receipt_time_raw: receiptTimeRaw,
              dify_drink_list: (payload.drinkList ?? null) as any,
            })
          : null;
      timing.fingerprint_ms = Math.round(performance.now() - tFingerprint);

      let updated: DbReceiptSubmission;
      const tDbUpdate = performance.now();
      try {
        updated = await repo.updateSubmission(claimed.id, {
          status: finalStatus,
          dify_raw: difyRaw as any,
          dify_drink_list: (payload.drinkList ?? null) as any,
          receipt_time_raw: receiptTimeRaw,
          retinfo_is_availd: retinfoIsAvaild,
          time_threshold: timeThreshold,
          points_base: earnedBasePoints,
          points_multiplier: bonusSnapshot.multiplier,
          points_bonus_sources: bonusSnapshot.sources,
          points_total: totalPoints,
          receipt_fingerprint: finalStatus === "verified" ? receiptFingerprint : null,
          rejection_code: null,
          duplicate_of: null,
          verified_at: nowIso,
        });
      } catch (err) {
        // Concurrency-safe dedup: DB unique index on verified receipt_fingerprint.
        if (finalStatus === "verified" && receiptFingerprint && isUniqueViolation(err)) {
          const winner = await repo.getVerifiedSubmissionByFingerprint(receiptFingerprint);
          updated = await repo.updateSubmission(claimed.id, {
            status: "rejected",
            dify_raw: difyRaw as any,
            dify_drink_list: (payload.drinkList ?? null) as any,
            receipt_time_raw: receiptTimeRaw,
            retinfo_is_availd: retinfoIsAvaild,
            time_threshold: timeThreshold,
            points_base: 0,
            points_multiplier: 1,
            points_bonus_sources: [],
            points_total: 0,
            receipt_fingerprint: receiptFingerprint,
            rejection_code: "duplicate_receipt",
            duplicate_of: winner?.id ?? null,
            verified_at: nowIso,
          });
        } else if (finalStatus === "verified" && isDailyLimitError(err, "daily_verified_limit_exceeded")) {
          await repo.updateSubmission(claimed.id, {
            status: "uploaded",
            points_base: 0,
            points_multiplier: 1,
            points_bonus_sources: [],
            points_total: 0,
            receipt_fingerprint: null,
            rejection_code: null,
            duplicate_of: null,
          });
          return;
        } else {
          throw err;
        }
      }
      timing.db_update_ms = Math.round(performance.now() - tDbUpdate);

      if (updated.status === "rejected") {
        try {
          const tDelete = performance.now();
          await deleteObject({
            s3,
            region: config.AWS_REGION,
            bucket: claimed.image_bucket,
            key: claimed.image_key,
          });
          timing.s3_delete_ms = Math.round(performance.now() - tDelete);
        } catch (deleteErr) {
          console.warn("s3_delete_rejected_image_failed", {
            bucket: claimed.image_bucket,
            key: claimed.image_key,
            message: deleteErr instanceof Error ? deleteErr.message : String(deleteErr),
          });
        }
      }
      updatedForLog = updated;
    } catch (err) {
      console.error("verification_failed", err);
      errorForLog = {
        message: err instanceof Error ? err.message : String(err),
        code: getPostgresErrorCode(err),
      };
      const tDbUpdate = performance.now();
      const updated = await repo.updateSubmission(claimed.id, {
        status: "rejected",
        dify_raw: {
          error: "verification_failed",
          message: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        } as any,
        points_base: 0,
        points_multiplier: 1,
        points_bonus_sources: [],
        points_total: 0,
        verified_at: new Date().toISOString(),
      });
      timing.db_update_ms = Math.round(performance.now() - tDbUpdate);
      updatedForLog = updated;
      try {
        const tDelete = performance.now();
        await deleteObject({
          s3,
          region: config.AWS_REGION,
          bucket: claimed.image_bucket,
          key: claimed.image_key,
        });
        timing.s3_delete_ms = Math.round(performance.now() - tDelete);
      } catch (deleteErr) {
        console.warn("s3_delete_rejected_image_failed", {
          bucket: claimed.image_bucket,
          key: claimed.image_key,
          message: deleteErr instanceof Error ? deleteErr.message : String(deleteErr),
        });
      }
    } finally {
      timing.total_ms = Math.round(performance.now() - verifyStart);
      console.info("bb_verify_timing", {
        submission_id: claimed.id,
        user_id: authed.sub,
        status: updatedForLog?.status ?? null,
        points_total: updatedForLog?.points_total ?? null,
        image_bytes: imageBytesForLog,
        timing_ms: timing,
        error: errorForLog,
        dify_mode: config.DIFY_MODE,
      });
    }
    };

    runInBackground(
      verifyInBackground().catch((err) => {
        console.error("verification_background_unhandled", {
          submission_id: claimed.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }),
    );

    return jsonResponse(config, req, 200, { submission: claimed });
  }

  if (req.method === "GET" && ctx.routePath === "/submissions") {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");
    const rows = await getRepo().listSubmissions(authed.sub, 50);
    return jsonResponse(config, req, 200, { submissions: rows });
  }

  const getMatch = ctx.routePath.match(/^\/submissions\/([^/]+)$/);
  if (req.method === "GET" && getMatch) {
    const authed = await requireAuth(config, req);
    if (!authed) return errorResponse(config, req, 401, "unauthorized");
    const submissionId = parseUuid(getMatch[1]);
    if (!submissionId) return errorResponse(config, req, 400, "invalid_params");

    const submission = await getRepo().getSubmissionById(submissionId);
    if (!submission || submission.user_id !== authed.sub)
      return errorResponse(config, req, 404, "not_found");
    return jsonResponse(config, req, 200, { submission });
  }

  return errorResponse(config, req, 404, "not_found");
};

const config = loadConfig();
const handler = handleRequest(config);

serve(async (req) => {
  const url = new URL(req.url);
  const routePath = getRoutePath(url.pathname);
  try {
    return await handler(req, { routePath });
  } catch (err) {
    console.error("unhandled_error", err);
    return errorResponse(config, req, 500, "internal_error");
  }
});
