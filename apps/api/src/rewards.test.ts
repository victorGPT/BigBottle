import { Interface } from 'ethers';
import { describe, expect, it, vi } from 'vitest';

import { computeClaimableB3trWei } from './rewards.js';
import { createOrGetRewardClaimAndSubmit, getRewardsPoolStatus } from './rewards-service.js';
import { createRewardsChain } from './vebetterRewards.js';
import type { AppConfig } from './config.js';
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
    time_threshold: 'true',
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
      getTransactionReceipt: async () => null,
      getRewardPoolBalance: async () => ({
        availableFundsWei: 0n,
        appId: `0x${'0'.repeat(64)}`,
        rewardsPoolAddress: '0x0000000000000000000000000000000000000000',
        network: 'testnet' as const
      })
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
      getTransactionReceipt: async () => null,
      getRewardPoolBalance: async () => ({
        availableFundsWei: 0n,
        appId: `0x${'0'.repeat(64)}`,
        rewardsPoolAddress: '0x0000000000000000000000000000000000000000',
        network: 'testnet' as const
      })
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
      getTransactionReceipt: async () => null,
      getRewardPoolBalance: async () => ({
        availableFundsWei: 0n,
        appId: `0x${'0'.repeat(64)}`,
        rewardsPoolAddress: '0x0000000000000000000000000000000000000000',
        network: 'testnet' as const
      })
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

  it('fails the claim when raw transaction broadcast is rejected', async () => {
    const createdClaim = rewardClaim();
    const submittedClaim = rewardClaim({
      status: 'submitted',
      tx_hash: '0x' + '4'.repeat(64),
      raw_tx: '0xraw'
    });
    const updates: Array<Partial<DbRewardClaim>> = [];
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
      updateRewardClaim: async (_id: string, patch: Partial<DbRewardClaim>) => {
        updates.push(patch);
        return {
          ...submittedClaim,
          ...patch
        };
      },
      listRewardClaims: async () => []
    };
    const chain = {
      signRewardDistributionTx: async () => ({ txHash: submittedClaim.tx_hash!, rawTx: submittedClaim.raw_tx! }),
      broadcastRawTransaction: async () => {
        throw new Error('tx rejected: insufficient energy');
      },
      getTransactionReceipt: async () => null,
      getRewardPoolBalance: async () => ({
        availableFundsWei: 0n,
        appId: `0x${'0'.repeat(64)}`,
        rewardsPoolAddress: '0x0000000000000000000000000000000000000000',
        network: 'testnet' as const
      })
    };

    await expect(
      createOrGetRewardClaimAndSubmit({
        repo,
        chain,
        userId: createdClaim.user_id,
        walletAddressLower: createdClaim.wallet_address,
        clientClaimId: createdClaim.client_claim_id,
        isUniqueViolation: () => false
      })
    ).rejects.toThrow('tx rejected: insufficient energy');

    expect(updates).toContainEqual({
      status: 'submitted',
      tx_hash: submittedClaim.tx_hash,
      raw_tx: submittedClaim.raw_tx,
      failure_reason: null
    });
    expect(updates).toContainEqual({
      status: 'failed',
      failure_reason: 'tx rejected: insufficient energy'
    });
  });

  it('formats reward distribution pool balance from chain status', async () => {
    const pool = await getRewardsPoolStatus({
      signRewardDistributionTx: async () => ({ txHash: '0x', rawTx: '0x' }),
      broadcastRawTransaction: async () => ({ txHash: '0x' }),
      getTransactionReceipt: async () => null,
      getRewardPoolBalance: async () => ({
        availableFundsWei: 12_345_678_900_000_000_000n,
        appId: `0x${'1'.repeat(64)}`,
        rewardsPoolAddress: '0x0000000000000000000000000000000000000001',
        network: 'mainnet'
      })
    });

    expect(pool.b3tr_available_funds_wei).toBe('12345678900000000000');
    expect(pool.b3tr_available_funds).toBe('12.3456789');
    expect(pool.app_id).toBe(`0x${'1'.repeat(64)}`);
    expect(pool.rewards_pool_address).toBe('0x0000000000000000000000000000000000000001');
    expect(pool.network).toBe('mainnet');
    expect(Date.parse(pool.updated_at)).not.toBeNaN();
  });

  it('reads the user-claim distribution pool balance from rewardsPoolBalance', async () => {
    const appId = `0x${'1'.repeat(64)}`;
    const rewardsPoolAddress = '0x0000000000000000000000000000000000000001';
    const iface = new Interface(['function rewardsPoolBalance(bytes32 appId) view returns (uint256)']);
    let requestBody: any = null;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        requestBody = JSON.parse(String((init as RequestInit).body));
        return new Response(
          JSON.stringify([
            {
              data: iface.encodeFunctionResult('rewardsPoolBalance', [1_090n * 10n ** 18n])
            }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      })
    );

    const chain = createRewardsChain({
      REWARDS_MODE: 'chain',
      VECHAIN_NETWORK: 'mainnet',
      VECHAIN_NODE_URL: 'https://mainnet.vechain.org',
      VEBETTER_APP_ID: appId,
      X2EARN_REWARDS_POOL_ADDRESS: rewardsPoolAddress
    } as AppConfig);

    const balance = await chain.getRewardPoolBalance();

    expect(requestBody.clauses[0].to).toBe(rewardsPoolAddress);
    expect(requestBody.clauses[0].data.slice(0, 10)).toBe(iface.getFunction('rewardsPoolBalance')!.selector);
    expect(balance.availableFundsWei).toBe(1_090n * 10n ** 18n);
    expect(balance.appId).toBe(appId);
    expect(balance.rewardsPoolAddress).toBe(rewardsPoolAddress);
    expect(balance.network).toBe('mainnet');
  });
});
