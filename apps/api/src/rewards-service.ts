import { computeClaimableB3trWei, formatB3trDisplay } from './rewards.js';
import { calculatePlasticReductionGrams } from './plastic-impact.js';
import { parseAmount, parseCapacityMl } from './scoring.js';
import type { DbReceiptSubmission, DbRewardClaim, DbRewardConversionRate, DbRewardClaimSource } from './supabase.js';
import type { RewardsChain } from './vebetterRewards.js';

const MAX_METADATA_SOURCE_ITEMS = 10;
const MAX_METADATA_DRINKS_PER_SOURCE = 3;

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
  listRewardClaimSourceSubmissions: (userId: string) => Promise<DbReceiptSubmission[]>;
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
  createRewardClaimSources: (inputs: Array<{
    claim_id: string;
    submission_id: string;
    points_total: number;
    receipt_fingerprint: string | null;
    dify_drink_list: unknown | null;
  }>) => Promise<DbRewardClaimSource[]>;
  listRewardClaims: (userId: string, limit?: number) => Promise<DbRewardClaim[]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function summarizeDrinkList(drinkList: unknown): {
  bottleCount: number;
  totalMl: number;
  drinks: Array<{ name: string | null; capacity_ml: number | null; amount: number }>;
} {
  const list = Array.isArray(drinkList) ? drinkList.slice(0, 25) : [];
  const drinks = list.map((item) => {
    const record = isRecord(item) ? item : {};
    const capacityMl = parseCapacityMl(record.retinfoDrinkCapacity);
    const amount = parseAmount(record.retinfoDrinkAmount);
    const rawName = record.retinfoDrinkName;
    const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 80) : null;
    return { name, capacity_ml: capacityMl, amount };
  });
  return {
    bottleCount: drinks.reduce((sum, item) => sum + item.amount, 0),
    totalMl: drinks.reduce((sum, item) => sum + (item.capacity_ml ?? 0) * item.amount, 0),
    drinks
  };
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
    const sourceCandidates = await repo.listRewardClaimSourceSubmissions(userId);
    const selectedSources = selectSourcesForPoints(sourceCandidates, claim.points_claimed);
    const selectedPoints = selectedSources.reduce((sum, source) => sum + source.points_total, 0);
    if (selectedSources.length === 0 || selectedPoints !== claim.points_claimed) {
      throw new Error('no_claimable_sources');
    }

    await repo.createRewardClaimSources(
      selectedSources.map((source) => ({
        claim_id: claim.id,
        submission_id: source.id,
        points_total: source.points_total,
        receipt_fingerprint: source.receipt_fingerprint,
        dify_drink_list: source.dify_drink_list
      }))
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
        drinks: summary.drinks.slice(0, MAX_METADATA_DRINKS_PER_SOURCE)
      };
    });
    const bottleCount = sourceSummaries.reduce((sum, source) => sum + source.bottle_count, 0);
    const totalMl = sourceSummaries.reduce((sum, source) => sum + source.total_ml, 0);
    const plasticReductionGrams = Math.round(calculatePlasticReductionGrams({ bottleCount: Math.max(1, bottleCount) }));

    const proofText = `BigBottle verified ${selectedSources.length} receipt(s), ${bottleCount} bottle(s), ${totalMl} ml total.`;
    const metadata = JSON.stringify({
      schema: 'bigbottle.reward_claim.v1',
      claim: {
        claim_id: claim.id,
        points_claimed: claim.points_claimed,
        points_per_b3tr: claim.points_per_b3tr_snapshot,
        b3tr_amount_wei: claim.b3tr_amount_wei,
        conversion_rate_id: claim.conversion_rate_id
      },
      impact_model: {
        code: 'bigbottle-plastic-v1',
        baseline_ml: 500,
        plastic_unit: 'grams'
      },
      sources: {
        submission_count: selectedSources.length,
        bottle_count: bottleCount,
        total_ml: totalMl,
        items_truncated: sourceSummaries.length > MAX_METADATA_SOURCE_ITEMS,
        items: sourceSummaries.slice(0, MAX_METADATA_SOURCE_ITEMS)
      }
    });

    const { txHash, rawTx } = await chain.signRewardDistributionTx({
      receiver: walletAddressLower,
      amountWei,
      claimId: claim.id,
      description: 'BigBottle receipt verified recycling reward',
      proof: {
        text: proofText
      },
      impacts: {
        plastic: plasticReductionGrams
      },
      metadata
    });

    // Persist tx details before broadcasting to avoid duplicate issuance on retries.
    let submitted = await repo.updateRewardClaim(claim.id, {
      status: 'submitted',
      tx_hash: txHash,
      raw_tx: rawTx,
      failure_reason: null
    });

    try {
      const sent = await chain.broadcastRawTransaction(rawTx);
      if (sent.txHash && sent.txHash !== submitted.tx_hash) {
        submitted = await repo.updateRewardClaim(claim.id, { tx_hash: sent.txHash });
      }
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
