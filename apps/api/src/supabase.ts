import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from './config.js';

export type DbUser = {
  id: string;
  wallet_address: string;
  created_at: string;
};

export type DbAuthChallenge = {
  id: string;
  wallet_address: string;
  nonce: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export type DbReceiptSubmission = {
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
  receipt_fingerprint: string | null;
  rejection_code: string | null;
  duplicate_of: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DbVoteBonusEligibility = {
  id: number;
  effective_round_id: number;
  source_round_id: number;
  passport_address: string;
  user_id: string | null;
  bonus_type: string;
  bonus_multiplier: number;
  status: string;
  source: string;
  computed_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

function ensureOk<T>(
  res: { data: T; error: unknown | null },
  message: string
): T {
  if (res.error) {
    const errText =
      typeof res.error === 'object' ? JSON.stringify(res.error) : String(res.error);
    // Preserve the structured PostgREST error for callers that need to inspect error codes.
    throw new Error(`${message}: ${errText}`, { cause: res.error });
  }
  return res.data;
}

export function createSupabaseAdmin(config: AppConfig): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function createRepo(supabase: SupabaseClient) {
  return {
    async getOrCreateUser(walletAddressLower: string): Promise<DbUser> {
      const upsertRes = await supabase
        .from('users')
        .upsert(
          {
            wallet_address: walletAddressLower
          },
          { onConflict: 'wallet_address' }
        )
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
      const res = await supabase
        .from('auth_challenges')
        .insert(input)
        .select('*')
        .single();
      return ensureOk(res, 'Failed to create auth challenge') as DbAuthChallenge;
    },

    async getAuthChallenge(id: string): Promise<DbAuthChallenge | null> {
      const res = await supabase
        .from('auth_challenges')
        .select('*')
        .eq('id', id)
        .maybeSingle();
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
      const res = await supabase
        .from('receipt_submissions')
        .select('*')
        .eq('id', id)
        .maybeSingle();
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
      const res = await supabase
        .from('receipt_submissions')
        .insert(input)
        .select('*')
        .single();
      return ensureOk(res, 'Failed to create submission') as DbReceiptSubmission;
    },

    async updateSubmission(
      id: string,
      patch: Partial<Omit<DbReceiptSubmission, 'id' | 'user_id' | 'created_at'>>
    ): Promise<DbReceiptSubmission> {
      const res = await supabase
        .from('receipt_submissions')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
      return ensureOk(res, 'Failed to update submission') as DbReceiptSubmission;
    },

    async computeReceiptFingerprint(input: {
      receipt_time_raw: string | null;
      dify_drink_list: unknown | null;
    }): Promise<string | null> {
      const res = await supabase.rpc('bb_receipt_fingerprint', {
        receipt_time_raw: input.receipt_time_raw,
        dify_drink_list: input.dify_drink_list as any
      });
      const data = ensureOk(res, 'Failed to compute receipt fingerprint');
      return typeof data === 'string' && data.trim() ? data.trim() : null;
    },

    async getUserPointsTotal(userId: string): Promise<number> {
      const res = await supabase.rpc('bb_user_points_total', { user_id: userId });
      const data = ensureOk(res, 'Failed to compute user points total');
      return typeof data === 'number' && Number.isFinite(data) ? data : 0;
    },

    async getLatestUserBonusEligibility(input: {
      user_id: string;
      wallet_address: string;
      bonus_type: string;
    }): Promise<DbVoteBonusEligibility | null> {
      const walletLower = input.wallet_address.trim().toLowerCase();
      const orFilter = `user_id.eq.${input.user_id},passport_address.eq.${walletLower}`;
      const res = await supabase
        .from('bigbottle_vote_bonus_eligibility')
        .select('*')
        .eq('bonus_type', input.bonus_type)
        .eq('status', 'eligible')
        .or(orFilter)
        .order('effective_round_id', { ascending: false })
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const data = ensureOk(res, 'Failed to fetch user bonus eligibility');
      return (data as DbVoteBonusEligibility) ?? null;
    },

    async getVerifiedSubmissionByFingerprint(fingerprint: string): Promise<Pick<DbReceiptSubmission, 'id' | 'user_id' | 'created_at'> | null> {
      const res = await supabase
        .from('receipt_submissions')
        .select('id,user_id,created_at')
        .eq('receipt_fingerprint', fingerprint)
        .eq('status', 'verified')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      const data = ensureOk(res, 'Failed to fetch submission by fingerprint');
      return (data as any) ?? null;
    },

    async updateSubmissionStatusIfCurrent(input: {
      id: string;
      from: string;
      to: string;
    }): Promise<DbReceiptSubmission | null> {
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

export type Repo = ReturnType<typeof createRepo>;
