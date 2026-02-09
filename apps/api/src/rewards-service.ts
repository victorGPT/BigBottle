import { computeClaimableB3trWei, formatB3trDisplay } from './rewards.js';
import type { DbRewardClaim, DbRewardConversionRate } from './supabase.js';
import type { RewardsChain } from './vebetterRewards.js';

export type RewardsQuote = {
  points_total: number;
  points_locked: number;
  points_available: number;
  points_per_b3tr: number;
  conversion_rate_id: string;
  b3tr_amount_wei: string;
  b3tr_amount: string;
};

export type RewardsRepo = {
  getUserPointsTotal: (userId: string) => Promise<number>;
  getUserPointsLocked: (userId: string) => Promise<number>;
  getActiveRewardConversionRate: () => Promise<DbRewardConversionRate | null>;
  getRewardClaimByClientId: (input: { user_id: string; client_claim_id: string }) => Promise<DbRewardClaim | null>;
  getInflightRewardClaim: (userId: string) => Promise<DbRewardClaim | null>;
  getRewardClaimById: (id: string) => Promise<DbRewardClaim | null>;
  createRewardClaim: (input: {
    user_id: string;
    wallet_address: string;
    client_claim_id: string;
    conversion_rate_id: string;
    points_per_b3tr_snapshot: number;
    points_claimed: number;
    b3tr_amount_wei: string;
    status: string;
  }) => Promise<DbRewardClaim>;
  updateRewardClaim: (
    id: string,
    patch: Partial<Omit<DbRewardClaim, 'id' | 'user_id' | 'created_at'>>
  ) => Promise<DbRewardClaim>;
  listRewardClaims: (userId: string, limit?: number) => Promise<DbRewardClaim[]>;
};

export async function getRewardsQuote(repo: RewardsRepo, userId: string): Promise<RewardsQuote> {
  const [pointsTotal, pointsLocked, rate] = await Promise.all([
    repo.getUserPointsTotal(userId),
    repo.getUserPointsLocked(userId),
    repo.getActiveRewardConversionRate()
  ]);

  if (!rate) throw new Error('rewards_unconfigured');

  const pointsAvailable = Math.max(0, pointsTotal - pointsLocked);
  const b3trWei = computeClaimableB3trWei({
    pointsAvailable,
    pointsPerB3tr: rate.points_per_b3tr
  });

  return {
    points_total: pointsTotal,
    points_locked: pointsLocked,
    points_available: pointsAvailable,
    points_per_b3tr: rate.points_per_b3tr,
    conversion_rate_id: rate.id,
    b3tr_amount_wei: b3trWei.toString(),
    b3tr_amount: formatB3trDisplay(b3trWei)
  };
}

export async function listRewardClaims(repo: RewardsRepo, userId: string, limit = 20): Promise<DbRewardClaim[]> {
  return await repo.listRewardClaims(userId, limit);
}

export async function refreshRewardClaimStatus(
  repo: RewardsRepo,
  chain: RewardsChain,
  claim: DbRewardClaim
): Promise<DbRewardClaim> {
  if (claim.status !== 'submitted' || !claim.tx_hash) return claim;

  const receipt = await chain.getTransactionReceipt(claim.tx_hash);
  if (!receipt) return claim;

  if (receipt.reverted) {
    return await repo.updateRewardClaim(claim.id, {
      status: 'failed',
      failure_reason: 'tx_reverted'
    });
  }

  return await repo.updateRewardClaim(claim.id, {
    status: 'confirmed',
    failure_reason: null
  });
}

export async function createOrGetRewardClaimAndSubmit(input: {
  repo: RewardsRepo;
  chain: RewardsChain;
  userId: string;
  walletAddressLower: string;
  clientClaimId: string;
  isUniqueViolation: (err: unknown) => boolean;
}): Promise<DbRewardClaim> {
  const { repo, chain, userId, walletAddressLower, clientClaimId, isUniqueViolation } = input;

  const existing = await repo.getRewardClaimByClientId({ user_id: userId, client_claim_id: clientClaimId });
  if (existing) return existing;

  const inflight = await repo.getInflightRewardClaim(userId);
  if (inflight) return inflight;

  const quote = await getRewardsQuote(repo, userId);
  if (quote.points_available <= 0) {
    throw new Error('no_claimable_points');
  }

  const amountWei = BigInt(quote.b3tr_amount_wei);
  if (amountWei <= 0n) {
    throw new Error('no_claimable_amount');
  }

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
      status: 'pending'
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
    const rewardMetadata = JSON.stringify({
      v: 1,
      claim_id: claim.id,
      points_claimed: claim.points_claimed,
      points_per_b3tr: claim.points_per_b3tr_snapshot
    });

    const { txHash, rawTx } = await chain.signRewardDistributionTx({
      receiver: walletAddressLower,
      amountWei,
      claimId: claim.id,
      description: 'BigBottle reward claim',
      rewardMetadata
    });

    // Persist tx details before broadcasting to avoid duplicate issuance on retries.
    const submitted = await repo.updateRewardClaim(claim.id, {
      status: 'submitted',
      tx_hash: txHash,
      raw_tx: rawTx,
      failure_reason: null
    });

    try {
      await chain.broadcastRawTransaction(rawTx);
    } catch {
      // Best-effort: even if broadcasting fails, the raw tx is persisted and can be re-sent.
    }

    return submitted;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await repo.updateRewardClaim(claim.id, {
        status: 'failed',
        failure_reason: reason
      });
    } catch {
      // If updating fails, points may remain locked until manual intervention.
    }
    throw err;
  }
}

