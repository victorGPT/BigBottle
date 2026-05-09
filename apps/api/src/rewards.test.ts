import { describe, expect, it } from 'vitest';

import { computeClaimableB3trWei } from './rewards.js';
import { createOrGetRewardClaimAndSubmit } from './rewards-service.js';
import type { DbReceiptSubmission, DbRewardClaim, DbRewardConversionRate } from './supabase.js';

function rewardClaim(overrides: Partial<DbRewardClaim> = {}): DbRewardClaim {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: '22222222-2222-4222-8222-222222222222',
    wallet_address: '0x0000000000000000000000000000000000000001',
    client_claim_id: '33333333-3333-4333-8333-333333333333',
    conversion_rate_id: '44444444-4444-4444-8444-444444444444',
    points_per_b3tr_snapshot: 10,
    points_claimed: 12,
    b3tr_amount_wei: '1200000000000000000',
    status: 'pending',
    tx_hash: null,
    raw_tx: null,
    failure_reason: null,
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    ...overrides
  };
}

function submission(overrides: Partial<DbReceiptSubmission> = {}): DbReceiptSubmission {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    user_id: '22222222-2222-4222-8222-222222222222',
    client_submission_id: '66666666-6666-4666-8666-666666666666',
    status: 'verified',
    image_bucket: 'bucket',
    image_key: 'key',
    image_content_type: 'image/jpeg',
    dify_raw: null,
    dify_drink_list: [
      {
        retinfoDrinkName: 'Water',
        retinfoDrinkCapacity: 500,
        retinfoDrinkAmount: 1
      },
      {
        retinfoDrinkName: 'Tea',
        retinfoDrinkCapacity: 1000,
        retinfoDrinkAmount: 1
      }
    ],
    receipt_time_raw: '2026-05-08 00:00:00',
    retinfo_is_availd: 'true',
    time_threshold: 'false',
    points_base: 12,
    points_multiplier: 1,
    points_bonus_sources: [],
    points_total: 12,
    receipt_fingerprint: 'receipt-fingerprint',
    rejection_code: null,
    duplicate_of: null,
    verified_at: '2026-05-08T00:00:00.000Z',
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    ...overrides
  };
}

describe('rewards', () => {
  it('converts points to B3TR wei (18 decimals) with floor division', () => {
    expect(computeClaimableB3trWei({ pointsAvailable: 0, pointsPerB3tr: 10 })).toBe(0n);
    expect(computeClaimableB3trWei({ pointsAvailable: 1, pointsPerB3tr: 10 })).toBe(100_000_000_000_000_000n);
    expect(computeClaimableB3trWei({ pointsAvailable: 5, pointsPerB3tr: 10 })).toBe(500_000_000_000_000_000n);
    expect(computeClaimableB3trWei({ pointsAvailable: 10, pointsPerB3tr: 10 })).toBe(1_000_000_000_000_000_000n);
  });

  it('floors fractional conversions', () => {
    // floor(1e18/3)
    expect(computeClaimableB3trWei({ pointsAvailable: 1, pointsPerB3tr: 3 })).toBe(333_333_333_333_333_333n);
    // floor(2e18/3)
    expect(computeClaimableB3trWei({ pointsAvailable: 2, pointsPerB3tr: 3 })).toBe(666_666_666_666_666_666n);
  });

  it('rejects invalid inputs', () => {
    expect(() => computeClaimableB3trWei({ pointsAvailable: -1 as any, pointsPerB3tr: 10 })).toThrow();
    expect(() => computeClaimableB3trWei({ pointsAvailable: 10, pointsPerB3tr: 0 as any })).toThrow();
  });

  it('submits VeBetter proof and separate metadata from verified receipt sources', async () => {
    const createdClaim = rewardClaim();
    const submittedClaim = rewardClaim({
      status: 'submitted',
      tx_hash: '0x' + '1'.repeat(64),
      raw_tx: '0xraw'
    });
    let signedInput: any = null;
    const repo = {
      getUserPointsTotal: async () => 12,
      getUserPointsLocked: async () => 0,
      getActiveRewardConversionRate: async (): Promise<DbRewardConversionRate> => ({
        id: createdClaim.conversion_rate_id,
        points_per_b3tr: 10,
        active: true,
        created_at: '2026-05-08T00:00:00.000Z'
      }),
      getRewardClaimByClientId: async () => null,
      getInflightRewardClaim: async () => null,
      getRewardClaimById: async () => null,
      listRewardClaimSourceSubmissions: async () => [submission()],
      createRewardClaim: async () => createdClaim,
      createRewardClaimSources: async (inputs: any[]) => inputs,
      updateRewardClaim: async (_id: string, patch: Partial<DbRewardClaim>) => ({
        ...submittedClaim,
        ...patch
      }),
      listRewardClaims: async () => []
    };
    const chain = {
      signRewardDistributionTx: async (input: any) => {
        signedInput = input;
        return { txHash: submittedClaim.tx_hash!, rawTx: submittedClaim.raw_tx! };
      },
      broadcastRawTransaction: async () => ({ txHash: submittedClaim.tx_hash! }),
      getTransactionReceipt: async () => null
    };

    await createOrGetRewardClaimAndSubmit({
      repo,
      chain,
      userId: createdClaim.user_id,
      walletAddressLower: createdClaim.wallet_address,
      clientClaimId: createdClaim.client_claim_id,
      isUniqueViolation: () => false
    });

    expect(signedInput.description).toBe('BigBottle receipt verified recycling reward');
    expect(signedInput.proof.text).toContain('2 bottle(s)');
    expect(signedInput.impacts.plastic).toBeGreaterThan(0);

    const metadata = JSON.parse(signedInput.metadata);
    expect(metadata.schema).toBe('bigbottle.reward_claim.v1');
    expect(metadata.claim.claim_id).toBe(createdClaim.id);
    expect(metadata.sources.submission_count).toBe(1);
    expect(metadata.sources.bottle_count).toBe(2);
    expect(metadata.sources.total_ml).toBe(1500);
    expect(metadata.sources.items_truncated).toBe(false);
    expect(metadata.sources.items[0].receipt_fingerprint).toBe('receipt-fingerprint');
  });

  it('does not force a positive plastic reduction for one baseline bottle', async () => {
    const createdClaim = rewardClaim({
      points_claimed: 2,
      b3tr_amount_wei: '200000000000000000'
    });
    const submittedClaim = rewardClaim({
      ...createdClaim,
      status: 'submitted',
      tx_hash: '0x' + '2'.repeat(64),
      raw_tx: '0xraw'
    });
    let signedInput: any = null;
    const repo = {
      getUserPointsTotal: async () => 2,
      getUserPointsLocked: async () => 0,
      getActiveRewardConversionRate: async (): Promise<DbRewardConversionRate> => ({
        id: createdClaim.conversion_rate_id,
        points_per_b3tr: 10,
        active: true,
        created_at: '2026-05-08T00:00:00.000Z'
      }),
      getRewardClaimByClientId: async () => null,
      getInflightRewardClaim: async () => null,
      getRewardClaimById: async () => null,
      listRewardClaimSourceSubmissions: async () => [
        submission({
          points_total: 2,
          dify_drink_list: [
            {
              retinfoDrinkName: 'Water',
              retinfoDrinkCapacity: 500,
              retinfoDrinkAmount: 1
            }
          ]
        })
      ],
      createRewardClaim: async () => createdClaim,
      createRewardClaimSources: async (inputs: any[]) => inputs,
      updateRewardClaim: async (_id: string, patch: Partial<DbRewardClaim>) => ({
        ...submittedClaim,
        ...patch
      }),
      listRewardClaims: async () => []
    };
    const chain = {
      signRewardDistributionTx: async (input: any) => {
        signedInput = input;
        return { txHash: submittedClaim.tx_hash!, rawTx: submittedClaim.raw_tx! };
      },
      broadcastRawTransaction: async () => ({ txHash: submittedClaim.tx_hash! }),
      getTransactionReceipt: async () => null
    };

    await createOrGetRewardClaimAndSubmit({
      repo,
      chain,
      userId: createdClaim.user_id,
      walletAddressLower: createdClaim.wallet_address,
      clientClaimId: createdClaim.client_claim_id,
      isUniqueViolation: () => false
    });

    expect(signedInput.impacts.plastic).toBe(0);
  });

  it('caps on-chain reward metadata source details', async () => {
    const createdClaim = rewardClaim({
      points_claimed: 11,
      b3tr_amount_wei: '1100000000000000000'
    });
    const submittedClaim = rewardClaim({
      ...createdClaim,
      status: 'submitted',
      tx_hash: '0x' + '3'.repeat(64),
      raw_tx: '0xraw'
    });
    let signedInput: any = null;
    const sources = Array.from({ length: 11 }, (_, idx) =>
      submission({
        id: `55555555-5555-4555-8555-${String(idx + 1).padStart(12, '0')}`,
        points_total: 1,
        receipt_fingerprint: `receipt-${idx + 1}`,
        dify_drink_list: Array.from({ length: 5 }, () => ({
          retinfoDrinkName: 'Water',
          retinfoDrinkCapacity: 500,
          retinfoDrinkAmount: 1
        }))
      })
    );
    const repo = {
      getUserPointsTotal: async () => 11,
      getUserPointsLocked: async () => 0,
      getActiveRewardConversionRate: async (): Promise<DbRewardConversionRate> => ({
        id: createdClaim.conversion_rate_id,
        points_per_b3tr: 10,
        active: true,
        created_at: '2026-05-08T00:00:00.000Z'
      }),
      getRewardClaimByClientId: async () => null,
      getInflightRewardClaim: async () => null,
      getRewardClaimById: async () => null,
      listRewardClaimSourceSubmissions: async () => sources,
      createRewardClaim: async () => createdClaim,
      createRewardClaimSources: async (inputs: any[]) => inputs,
      updateRewardClaim: async (_id: string, patch: Partial<DbRewardClaim>) => ({
        ...submittedClaim,
        ...patch
      }),
      listRewardClaims: async () => []
    };
    const chain = {
      signRewardDistributionTx: async (input: any) => {
        signedInput = input;
        return { txHash: submittedClaim.tx_hash!, rawTx: submittedClaim.raw_tx! };
      },
      broadcastRawTransaction: async () => ({ txHash: submittedClaim.tx_hash! }),
      getTransactionReceipt: async () => null
    };

    await createOrGetRewardClaimAndSubmit({
      repo,
      chain,
      userId: createdClaim.user_id,
      walletAddressLower: createdClaim.wallet_address,
      clientClaimId: createdClaim.client_claim_id,
      isUniqueViolation: () => false
    });

    const metadata = JSON.parse(signedInput.metadata);
    expect(metadata.sources.submission_count).toBe(11);
    expect(metadata.sources.items_truncated).toBe(true);
    expect(metadata.sources.items).toHaveLength(10);
    expect(metadata.sources.items[0].drinks).toHaveLength(3);
  });
});
