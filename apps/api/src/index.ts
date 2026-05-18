import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'crypto';
import { Interface, getAddress } from 'ethers';

import './types.js';
import { loadConfig } from './config.js';
import { buildLoginTypedData, verifyLoginSignature } from './auth.js';
import { createRepo, createSupabaseAdmin, type DbRewardClaim } from './supabase.js';
import {
  applyPointsMultiplier,
  computeAdditiveBonusMultiplier,
  computeTotalPoints,
  resolveBonusMultiplier
} from './scoring.js';
import { createS3Client, deleteObject, headObject, presignGetObject, presignPutObject } from './s3.js';
import { extractDifyReceiptPayload, runDify } from './dify.js';
import { isUniqueViolation } from './postgres-errors.js';
import {
  createOrGetRewardClaimAndSubmit,
  getRewardsPoolStatus,
  getRewardsQuote,
  listRewardClaims,
  refreshRewardClaimStatus
} from './rewards-service.js';
import { createRewardsChain } from './vebetterRewards.js';
import { formatB3trDisplay } from './rewards.js';
import {
  DAILY_SUCCESSFUL_RECEIPT_LIMIT,
  DAILY_TOTAL_UPLOAD_LIMIT,
  getUtcDayWindow,
  isDailyLimitError
} from './submission-limits.js';

type AuthedRequest = {
  user: { sub: string; wallet: string };
};

function normalizeWalletAddress(input: string): { checksum: string; lower: string } | null {
  try {
    const checksum = getAddress(input.trim());
    return { checksum, lower: checksum.toLowerCase() };
  } catch {
    return null;
  }
}

function normalizeBoolString(input: string): string {
  return input.trim().toLowerCase();
}

function formatRewardClaimForApi(claim: DbRewardClaim) {
  return {
    id: claim.id,
    client_claim_id: claim.client_claim_id,
    wallet_address: claim.wallet_address,

    conversion_rate_id: claim.conversion_rate_id,
    points_per_b3tr_snapshot: claim.points_per_b3tr_snapshot,
    points_claimed: claim.points_claimed,
    b3tr_amount_wei: claim.b3tr_amount_wei,
    b3tr_amount: formatB3trDisplay(BigInt(claim.b3tr_amount_wei)),

    status: claim.status,
    tx_hash: claim.tx_hash,
    failure_reason: claim.failure_reason,

    created_at: claim.created_at,
    updated_at: claim.updated_at
  };
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

const SubmissionIdParams = z.object({ id: z.string().uuid() });
const RewardClaimIdParams = z.object({ id: z.string().uuid() });
const RewardClaimBody = z.object({ client_claim_id: z.string().uuid() });
const RewardClaimsQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20)
});
const AccountAchievementsQuery = z.object({
  effective_round_id: z.coerce.number().int().positive().optional()
});

const VEBETTER_VOTE_BONUS_MULTIPLIER = 10;
const GM_NFT_BONUS_MULTIPLIER = 10;

type ReceiptBonusSource =
  | {
      type: 'vebetter_vote_bonus';
      multiplier: number;
      effective_round_id: number;
      source_round_id: number;
    }
  | {
      type: 'gm_nft';
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
  sources: []
};

function requireAuth() {
  return async function authenticate(request: any, reply: any) {
    try {
      await request.jwtVerify();
    } catch {
      // If auth fails, we short-circuit the request.
      return reply.code(401).send({ error: 'unauthorized' });
    }
  };
}

function computeAchievementTotalMultiplier(items: Array<{ unlocked: boolean; multiplier: number }>): number {
  return computeAdditiveBonusMultiplier(items.filter((item) => item.unlocked).map((item) => item.multiplier));
}

const VECHAIN_MAINNET_THOR_URL =
  process.env.VECHAIN_THOR_URL?.trim() ||
  process.env.VECHAIN_NODE_URL?.trim() ||
  'https://mainnet.vechain.org';
const VEBETTER_GALAXY_MEMBER_ADDRESS =
  process.env.VEBETTER_GALAXY_MEMBER_ADDRESS?.trim() || '0x93B8cD34A7Fc4f53271b9011161F7A2B5fEA9D1F';

const GALAXY_MEMBER_IFACE = new Interface([
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner,uint256 index) view returns (uint256)',
  'function getTokenInfoByTokenId(uint256 tokenId) view returns ((uint256 tokenId,string tokenURI,uint256 tokenLevel,uint256 b3trToUpgrade) tokenInfo)'
]);

const GM_NFT_LEVEL_NAME: Record<number, string> = {
  0: 'Earth',
  1: 'Moon',
  2: 'Mercury',
  3: 'Venus',
  4: 'Mars',
  5: 'Jupiter',
  6: 'Saturn',
  7: 'Uranus',
  8: 'Neptune',
  9: 'Pluto',
  10: 'Galaxy'
};

function resolveGmNftName(level: number): string {
  return GM_NFT_LEVEL_NAME[level] ?? `Level ${level}`;
}

async function callThorContract(to: string, data: string, caller: string): Promise<string> {
  const res = await fetch(`${VECHAIN_MAINNET_THOR_URL}/accounts/*`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clauses: [{ to, data, value: '0x0' }],
      caller
    })
  });

  if (!res.ok) {
    throw new Error(`thor call failed: ${res.status}`);
  }

  const payload = (await res.json()) as Array<{ data?: string }>;
  const output = payload?.[0]?.data;
  if (!output || output === '0x') {
    throw new Error('thor call returned empty data');
  }
  return output;
}

async function getHighestGmNftByOwner(walletAddress: string): Promise<{ level: number; name: string } | null> {
  const balanceHex = await callThorContract(
    VEBETTER_GALAXY_MEMBER_ADDRESS,
    GALAXY_MEMBER_IFACE.encodeFunctionData('balanceOf', [walletAddress]),
    walletAddress
  );

  const balanceRaw = GALAXY_MEMBER_IFACE.decodeFunctionResult('balanceOf', balanceHex)[0] as bigint;
  const balance = Number(balanceRaw);

  if (!Number.isFinite(balance) || balance <= 0) return null;

  let highestLevel = 0;

  for (let i = 0; i < balance; i += 1) {
    const tokenIdHex = await callThorContract(
      VEBETTER_GALAXY_MEMBER_ADDRESS,
      GALAXY_MEMBER_IFACE.encodeFunctionData('tokenOfOwnerByIndex', [walletAddress, BigInt(i)]),
      walletAddress
    );

    const tokenId = GALAXY_MEMBER_IFACE.decodeFunctionResult('tokenOfOwnerByIndex', tokenIdHex)[0] as bigint;

    const tokenInfoHex = await callThorContract(
      VEBETTER_GALAXY_MEMBER_ADDRESS,
      GALAXY_MEMBER_IFACE.encodeFunctionData('getTokenInfoByTokenId', [tokenId]),
      walletAddress
    );

    const tokenInfo = GALAXY_MEMBER_IFACE.decodeFunctionResult('getTokenInfoByTokenId', tokenInfoHex)[0] as {
      tokenLevel: bigint;
    };

    const level = Number(tokenInfo.tokenLevel);
    if (Number.isFinite(level) && level > highestLevel) {
      highestLevel = level;
    }
  }

  if (highestLevel <= 0) return null;

  return {
    level: highestLevel,
    name: resolveGmNftName(highestLevel)
  };
}

async function getReceiptBonusSnapshot(input: {
  repo: ReturnType<typeof createRepo>;
  userId: string;
  wallet: string;
  effectiveRoundId?: number;
  log?: { warn: (obj: unknown, msg?: string) => void };
}): Promise<ReceiptBonusSnapshot> {
  const sources: ReceiptBonusSource[] = [];

  try {
    const vebetterVote = await input.repo.getLatestUserBonusEligibility({
      user_id: input.userId,
      wallet_address: input.wallet,
      bonus_type: 'vebetter_vote_bonus',
      ...(input.effectiveRoundId === undefined ? {} : { effective_round_id: input.effectiveRoundId })
    });
    if (vebetterVote) {
      const multiplier = resolveBonusMultiplier(vebetterVote.bonus_multiplier, VEBETTER_VOTE_BONUS_MULTIPLIER);
      sources.push({
        type: 'vebetter_vote_bonus',
        multiplier,
        effective_round_id: vebetterVote.effective_round_id,
        source_round_id: vebetterVote.source_round_id
      });
    }
  } catch (err) {
    input.log?.warn({ err, wallet: input.wallet, userId: input.userId }, 'vote_bonus_lookup_failed');
  }

  try {
    const highestGmNft = await getHighestGmNftByOwner(input.wallet);
    if (highestGmNft) {
      sources.push({
        type: 'gm_nft',
        multiplier: GM_NFT_BONUS_MULTIPLIER,
        level: highestGmNft.level,
        name: highestGmNft.name
      });
    }
  } catch (err) {
    input.log?.warn({ err, wallet: input.wallet }, 'gm_nft_lookup_failed');
  }

  return {
    multiplier: computeAdditiveBonusMultiplier(sources.map((source) => source.multiplier)),
    sources
  };
}

async function main() {
  const config = loadConfig();
  const supabase = createSupabaseAdmin(config);
  const repo = createRepo(supabase);
  const s3 = createS3Client(config);
  const rewardsChain = createRewardsChain(config);

  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN,
    credentials: true
  });

  await app.register(jwt, {
    secret: config.JWT_SECRET
  });

  app.setErrorHandler((err, request, reply) => {
    const statusCode = typeof (err as any)?.statusCode === 'number' ? (err as any).statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err }, 'unhandled_error');
    } else {
      request.log.warn({ err }, 'request_error');
    }
    if (reply.sent) return;
    if (statusCode >= 500) {
      return reply.code(500).send({ error: 'internal_error' });
    }
    return reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 400).send({ error: 'bad_request' });
  });

  const authenticate = requireAuth();

  app.get('/health', async () => ({ ok: true }));

  // --- Auth ---
  const ChallengeBody = z.object({
    address: z.string().min(1)
  });

  app.post('/auth/challenge', async (request, reply) => {
    const parsed = ChallengeBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const wallet = normalizeWalletAddress(parsed.data.address);
    if (!wallet) return reply.code(400).send({ error: 'invalid_address' });

    const walletAddressLower = wallet.lower;
    const challengeId = randomUUID();
    const nonce = randomBytes(16).toString('hex');
    const expiresAtIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await repo.createAuthChallenge({
      id: challengeId,
      wallet_address: walletAddressLower,
      nonce,
      expires_at: expiresAtIso
    });

    const typedData = buildLoginTypedData({
      walletAddress: walletAddressLower,
      challengeId,
      nonce
    });

    return reply.send({
      challenge_id: challengeId,
      typed_data: typedData
    });
  });

  const VerifyBody = z.object({
    challenge_id: z.string().uuid(),
    signature: z.string().min(1)
  });

  app.post('/auth/verify', async (request, reply) => {
    const parsed = VerifyBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const challenge = await repo.getAuthChallenge(parsed.data.challenge_id);
    if (!challenge) return reply.code(401).send({ error: 'invalid_challenge' });
    if (challenge.used_at) return reply.code(401).send({ error: 'challenge_used' });
    if (Date.parse(challenge.expires_at) <= Date.now()) {
      return reply.code(401).send({ error: 'challenge_expired' });
    }

    const ok = verifyLoginSignature({
      walletAddress: challenge.wallet_address,
      challengeId: challenge.id,
      nonce: challenge.nonce,
      signature: parsed.data.signature
    });

    if (!ok) return reply.code(401).send({ error: 'invalid_signature' });

    const claimed = await repo.markAuthChallengeUsed(challenge.id);
    if (!claimed) return reply.code(401).send({ error: 'challenge_used' });

    const user = await repo.getOrCreateUser(challenge.wallet_address);
    const token = await reply.jwtSign(
      { sub: user.id, wallet: user.wallet_address },
      { expiresIn: '7d' }
    );

    return reply.send({
      access_token: token,
      user: { id: user.id, wallet_address: user.wallet_address }
    });
  });

  app.get('/me', { preHandler: authenticate }, async (request: any, reply) => {
    const { wallet, sub } = (request as AuthedRequest).user;
    // Keep DB as the user source of truth (upsert is idempotent)
    const user = await repo.getOrCreateUser(wallet);
    if (user.id !== sub) {
      // Token user id drift is not fatal in Phase 1, but we flag it.
      request.log.warn({ tokenUserId: sub, dbUserId: user.id }, 'token_user_id_mismatch');
    }
    return reply.send({ user });
  });

  // --- Account ---
  app.get('/account/summary', { preHandler: authenticate }, async (request: any, reply) => {
    const { sub: userId } = (request as AuthedRequest).user;
    const pointsTotal = await repo.getUserPointsTotal(userId);
    return reply.send({ summary: { points_total: pointsTotal, level: null } });
  });

  app.get('/account/achievements', { preHandler: authenticate }, async (request: any, reply) => {
    const { sub: userId, wallet } = (request as AuthedRequest).user;
    const parsedQuery = AccountAchievementsQuery.safeParse(request.query ?? {});
    if (!parsedQuery.success) return reply.code(400).send({ error: 'invalid_query' });

    const targetEffectiveRoundId =
      parsedQuery.data.effective_round_id ?? config.VEBETTER_CURRENT_EFFECTIVE_ROUND_ID;

    const voteEligibilityInput = {
      user_id: userId,
      wallet_address: wallet,
      bonus_type: 'vebetter_vote_bonus',
      ...(targetEffectiveRoundId === undefined
        ? {}
        : { effective_round_id: targetEffectiveRoundId })
    };

    const vebetterVote = await repo.getLatestUserBonusEligibility(voteEligibilityInput);

    let highestGmNft: { level: number; name: string } | null = null;
    try {
      highestGmNft = await getHighestGmNftByOwner(wallet);
    } catch (err) {
      request.log.warn({ err, wallet }, 'gm_nft_lookup_failed');
    }

    const unlocked = Boolean(vebetterVote);
    const multiplier = unlocked
      ? resolveBonusMultiplier(vebetterVote?.bonus_multiplier, VEBETTER_VOTE_BONUS_MULTIPLIER)
      : 1;

    const gmUnlocked = Boolean(highestGmNft);
    const gmLevel = highestGmNft?.level ?? null;
    const gmName = highestGmNft?.name ?? null;

    const achievements = [
      {
        key: 'vebetter_vote_bonus',
        title: 'VeBetterDAO Voter',
        description: '在 VeBetterDAO 任一投票中参与过投票，下期获得 BigPortal 积分加成。',
        badge: 'governance',
        unlocked,
        multiplier,
        status: unlocked ? vebetterVote?.status ?? 'eligible' : 'locked',
        effective_round_id: unlocked ? (vebetterVote?.effective_round_id ?? null) : null,
        source_round_id: unlocked ? (vebetterVote?.source_round_id ?? null) : null,
        node_name: null,
        node_level: null
      },
      {
        key: 'gm_nft',
        title: 'GM-NFT',
        description: gmUnlocked
          ? `已持有最高等级 GM-NFT：${gmName}`
          : '未检测到 GM-NFT。',
        badge: 'gm_nft',
        unlocked: gmUnlocked,
        multiplier: gmUnlocked ? GM_NFT_BONUS_MULTIPLIER : 1,
        status: gmUnlocked ? 'eligible' : 'locked',
        effective_round_id: null,
        source_round_id: null,
        node_name: gmName,
        node_level: gmLevel
      }
    ];

    const totalMultiplier = computeAchievementTotalMultiplier(achievements);
    const unlockedCount = achievements.filter((item) => item.unlocked).length;

    return reply.send({
      achievements,
      summary: {
        unlocked_count: unlockedCount,
        total_count: achievements.length,
        total_multiplier: Number(totalMultiplier.toFixed(4))
      }
    });
  });

  // --- Rewards (Phase 2) ---
  app.get('/rewards/pool', { preHandler: authenticate }, async (request: any, reply) => {
    try {
      const pool = await getRewardsPoolStatus(rewardsChain);
      return reply.send({ pool });
    } catch (err) {
      const code = err instanceof Error ? err.message : null;
      if (code === 'rewards_unconfigured') return reply.code(503).send({ error: 'rewards_unconfigured' });
      request.log.error({ err }, 'rewards_pool_failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  app.get('/rewards/quote', { preHandler: authenticate }, async (request: any, reply) => {
    const { sub: userId } = (request as AuthedRequest).user;
    try {
      const quote = await getRewardsQuote(repo as any, userId);
      return reply.send({ quote });
    } catch (err) {
      const code = err instanceof Error ? err.message : null;
      if (code === 'rewards_unconfigured') return reply.code(503).send({ error: 'rewards_unconfigured' });
      request.log.error({ err }, 'rewards_quote_failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  app.post('/rewards/claim', { preHandler: authenticate }, async (request: any, reply) => {
    const parsed = RewardClaimBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const { sub: userId, wallet: walletAddressLower } = (request as AuthedRequest).user;

    try {
      const claim = await createOrGetRewardClaimAndSubmit({
        repo: repo as any,
        chain: rewardsChain,
        userId,
        walletAddressLower,
        clientClaimId: parsed.data.client_claim_id,
        isUniqueViolation
      });
      return reply.send({ claim: formatRewardClaimForApi(claim) });
    } catch (err) {
      const code = err instanceof Error ? err.message : null;
      if (code === 'rewards_unconfigured') return reply.code(503).send({ error: 'rewards_unconfigured' });
      if (
        code === 'no_claimable_points' ||
        code === 'no_claimable_amount' ||
        code === 'no_claimable_sources' ||
        code === 'amount_invalid'
      ) {
        return reply.code(400).send({ error: code });
      }
      request.log.error({ err }, 'rewards_claim_failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  app.get('/rewards/claims', { preHandler: authenticate }, async (request: any, reply) => {
    const { sub: userId } = (request as AuthedRequest).user;
    const parsed = RewardClaimsQuery.safeParse((request as any).query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });
    const claims = await listRewardClaims(repo as any, userId, parsed.data.limit);
    return reply.send({ claims: claims.map(formatRewardClaimForApi) });
  });

  app.get('/rewards/claims/:id', { preHandler: authenticate }, async (request: any, reply) => {
    const { sub: userId } = (request as AuthedRequest).user;
    const parsedParams = RewardClaimIdParams.safeParse(request.params);
    if (!parsedParams.success) return reply.code(400).send({ error: 'invalid_params' });

    const claim = await repo.getRewardClaimById(parsedParams.data.id);
    if (!claim || claim.user_id !== userId) return reply.code(404).send({ error: 'not_found' });

    try {
      const refreshed = await refreshRewardClaimStatus(repo as any, rewardsChain, claim);
      return reply.send({ claim: formatRewardClaimForApi(refreshed) });
    } catch (err) {
      // Receipt polling should never block the UI; return the current claim state.
      request.log.warn({ err, claimId: claim.id, txHash: claim.tx_hash }, 'rewards_claim_refresh_failed');
      return reply.send({ claim: formatRewardClaimForApi(claim) });
    }
  });

  // --- Submissions ---
  const InitSubmissionBody = z.object({
    client_submission_id: z.string().uuid(),
    content_type: z.string().min(1)
  });

  app.post('/submissions/init', { preHandler: authenticate }, async (request: any, reply) => {
    const parsed = InitSubmissionBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const { sub: userId } = (request as AuthedRequest).user;
    const existing = await repo.getSubmissionByClientId({
      user_id: userId,
      client_submission_id: parsed.data.client_submission_id
    });

    if (existing) {
      if (existing.status === 'pending_upload') {
        const existingContentType = existing.image_content_type || 'application/octet-stream';
        const upload = await presignPutObject({
          s3,
          bucket: existing.image_bucket,
          key: existing.image_key,
          contentType: existingContentType,
          expiresInSeconds: config.S3_PRESIGN_EXPIRES_SECONDS
        });
        return reply.send({ submission: existing, upload: { method: 'PUT', ...upload } });
      }
      return reply.send({ submission: existing, upload: null });
    }

    const today = getUtcDayWindow();
    const [dailyUploadCount, dailyVerifiedCount] = await Promise.all([
      repo.countSubmissionsCreatedInWindow({
        user_id: userId,
        start_iso: today.startIso,
        end_iso: today.endIso
      }),
      repo.countVerifiedSubmissionsCreatedInWindow({
        user_id: userId,
        start_iso: today.startIso,
        end_iso: today.endIso
      })
    ]);
    if (dailyVerifiedCount >= DAILY_SUCCESSFUL_RECEIPT_LIMIT) {
      return reply.code(429).send({ error: 'daily_verified_limit_exceeded' });
    }
    if (dailyUploadCount >= DAILY_TOTAL_UPLOAD_LIMIT) {
      return reply.code(429).send({ error: 'daily_upload_limit_exceeded' });
    }

    const contentType = parsed.data.content_type.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(contentType)) {
      return reply.code(400).send({ error: 'unsupported_content_type' });
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

    const submissionId = randomUUID();
    const nowIso = new Date().toISOString();
    const month = nowIso.slice(0, 7);
    const day = nowIso.slice(0, 10);
    const imageKey = `uploads/${month}/${day}/${submissionId}.${ext}`;

    let created: Awaited<ReturnType<typeof repo.createSubmission>>;
    try {
      created = await repo.createSubmission({
        id: submissionId,
        user_id: userId,
        client_submission_id: parsed.data.client_submission_id,
        status: 'pending_upload',
        image_bucket: config.S3_BUCKET,
        image_key: imageKey,
        image_content_type: contentType
      });
    } catch (err) {
      // If the DB has a uniqueness constraint on (user_id, client_submission_id),
      // this makes init idempotent under races.
      request.log.warn({ err }, 'create_submission_failed');
      const again = await repo.getSubmissionByClientId({
        user_id: userId,
        client_submission_id: parsed.data.client_submission_id
      });
      if (again) {
        if (again.status === 'pending_upload') {
          const upload = await presignPutObject({
            s3,
            bucket: again.image_bucket,
            key: again.image_key,
            contentType: again.image_content_type || contentType,
              expiresInSeconds: config.S3_PRESIGN_EXPIRES_SECONDS
          });
          return reply.send({ submission: again, upload: { method: 'PUT', ...upload } });
        }
        return reply.send({ submission: again, upload: null });
      }
      if (isDailyLimitError(err, 'daily_upload_limit_exceeded')) {
        return reply.code(429).send({ error: 'daily_upload_limit_exceeded' });
      }
      throw err;
    }

    const upload = await presignPutObject({
      s3,
      bucket: created.image_bucket,
      key: created.image_key,
      contentType: created.image_content_type || contentType,
      expiresInSeconds: config.S3_PRESIGN_EXPIRES_SECONDS
    });

    return reply.send({ submission: created, upload: { method: 'PUT', ...upload } });
  });

  app.post('/submissions/:id/complete', { preHandler: authenticate }, async (request: any, reply) => {
    const { sub: userId } = (request as AuthedRequest).user;
    const parsedParams = SubmissionIdParams.safeParse(request.params);
    if (!parsedParams.success) return reply.code(400).send({ error: 'invalid_params' });

    const submission = await repo.getSubmissionById(parsedParams.data.id);
    if (!submission || submission.user_id !== userId) return reply.code(404).send({ error: 'not_found' });

    if (submission.status === 'pending_upload') {
      const meta = await headObject({ s3, bucket: submission.image_bucket, key: submission.image_key });
      if (!meta) return reply.code(409).send({ error: 'upload_not_found' });

      const updated =
        (await repo.updateSubmissionStatusIfCurrent({
          id: submission.id,
          from: 'pending_upload',
          to: 'uploaded'
        })) ?? submission;
      return reply.send({ submission: updated });
    }

    return reply.send({ submission });
  });

  app.post('/submissions/:id/verify', { preHandler: authenticate }, async (request: any, reply) => {
    const { sub: userId, wallet } = (request as AuthedRequest).user;
    const parsedParams = SubmissionIdParams.safeParse(request.params);
    if (!parsedParams.success) return reply.code(400).send({ error: 'invalid_params' });

    const submission = await repo.getSubmissionById(parsedParams.data.id);
    if (!submission || submission.user_id !== userId) return reply.code(404).send({ error: 'not_found' });

    if (['verified', 'rejected', 'not_claimable'].includes(submission.status)) {
      return reply.send({ submission });
    }
    if (submission.status === 'pending_upload') {
      return reply.code(409).send({ error: 'upload_incomplete' });
    }

    const uploadDay = getUtcDayWindow(new Date(submission.created_at));
    const dailyVerifiedCount = await repo.countVerifiedSubmissionsCreatedInWindow({
      user_id: userId,
      start_iso: uploadDay.startIso,
      end_iso: uploadDay.endIso
    });
    if (dailyVerifiedCount >= DAILY_SUCCESSFUL_RECEIPT_LIMIT) {
      return reply.code(429).send({ error: 'daily_verified_limit_exceeded' });
    }

    if (submission.status === 'verifying') {
      return reply.send({ submission });
    }

    const claimed = await repo.updateSubmissionStatusIfCurrent({
      id: submission.id,
      from: 'uploaded',
      to: 'verifying'
    });
    if (!claimed) {
      const fresh = await repo.getSubmissionById(submission.id);
      if (!fresh || fresh.user_id !== userId) return reply.code(404).send({ error: 'not_found' });
      return reply.send({ submission: fresh });
    }

    try {
      const meta = await headObject({ s3, bucket: claimed.image_bucket, key: claimed.image_key });
      if (!meta) {
        const reset = await repo.updateSubmission(claimed.id, { status: 'pending_upload' });
        return reply.code(409).send({ error: 'upload_incomplete', submission: reset });
      }

      const getUrl = await presignGetObject({
        s3,
        bucket: claimed.image_bucket,
        key: claimed.image_key,
        expiresInSeconds: Math.max(60, config.S3_PRESIGN_EXPIRES_SECONDS)
      });

      const difyRaw = await runDify(config, { imageUrl: getUrl.url, userRef: wallet });
      const payload = extractDifyReceiptPayload(difyRaw);

      if (!payload) {
        const updated = await repo.updateSubmission(claimed.id, {
          status: 'rejected',
          dify_raw: difyRaw as any,
          points_base: 0,
          points_multiplier: 1,
          points_bonus_sources: [],
          points_total: 0,
          verified_at: new Date().toISOString()
        });
        try {
          await deleteObject({ s3, bucket: updated.image_bucket, key: updated.image_key });
        } catch (err) {
          request.log.warn(
            { err, bucket: updated.image_bucket, key: updated.image_key },
            's3_delete_rejected_image_failed'
          );
        }
        return reply.send({ submission: updated });
      }

      if (typeof payload.user_id === 'string') {
        const difyUser = payload.user_id.trim();
        if (difyUser && difyUser !== wallet) {
          request.log.warn({ difyUser, wallet }, 'dify_user_id_mismatch_ignored');
        }
      }

      const nowIso = new Date().toISOString();
      const retinfoIsAvaildRaw =
        typeof payload.retinfoIsAvaild === 'string'
          ? payload.retinfoIsAvaild
          : String(payload.retinfoIsAvaild ?? '');
      const timeThresholdRaw =
        typeof payload.timeThreshold === 'string'
          ? payload.timeThreshold
          : String(payload.timeThreshold ?? '');
      const receiptTimeRaw =
        typeof payload.retinfoReceiptTime === 'string'
          ? payload.retinfoReceiptTime
          : payload.retinfoReceiptTime == null
            ? null
            : String(payload.retinfoReceiptTime);

      const retinfoIsAvaild = normalizeBoolString(retinfoIsAvaildRaw);
      const timeThreshold = normalizeBoolString(timeThresholdRaw);

      const ok = retinfoIsAvaild === 'true' && timeThreshold === 'false';
      const { totalPoints: basePoints } = computeTotalPoints(payload.drinkList);
      const bonusSnapshot =
        ok && basePoints > 0
          ? await getReceiptBonusSnapshot({
              repo,
              userId,
              wallet,
              ...(config.VEBETTER_CURRENT_EFFECTIVE_ROUND_ID === undefined
                ? {}
                : { effectiveRoundId: config.VEBETTER_CURRENT_EFFECTIVE_ROUND_ID }),
              log: request.log
            })
          : EMPTY_RECEIPT_BONUS_SNAPSHOT;
      const earnedBasePoints = ok ? basePoints : 0;
      const totalPoints = ok ? applyPointsMultiplier(earnedBasePoints, bonusSnapshot.multiplier) : 0;

      const finalStatus = ok ? (totalPoints > 0 ? 'verified' : 'not_claimable') : 'rejected';
      const receiptFingerprint =
        finalStatus === 'verified'
          ? await repo.computeReceiptFingerprint({
              receipt_time_raw: receiptTimeRaw,
              dify_drink_list: (payload.drinkList ?? null) as any
            })
          : null;

      let updated: any;
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
          points_bonus_sources: bonusSnapshot.sources as any,
          points_total: totalPoints,
          receipt_fingerprint: finalStatus === 'verified' ? receiptFingerprint : null,
          rejection_code: null,
          duplicate_of: null,
          verified_at: nowIso
        });
      } catch (err) {
        // Concurrency-safe dedup: DB unique index on verified receipt_fingerprint.
        if (finalStatus === 'verified' && receiptFingerprint && isUniqueViolation(err)) {
          const winner = await repo.getVerifiedSubmissionByFingerprint(receiptFingerprint);
          updated = await repo.updateSubmission(claimed.id, {
            status: 'rejected',
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
            rejection_code: 'duplicate_receipt',
            duplicate_of: winner?.id ?? null,
            verified_at: nowIso
          });
        } else if (finalStatus === 'verified' && isDailyLimitError(err, 'daily_verified_limit_exceeded')) {
          await repo.updateSubmission(claimed.id, {
            status: 'uploaded',
            points_base: 0,
            points_multiplier: 1,
            points_bonus_sources: [],
            points_total: 0,
            receipt_fingerprint: null,
            rejection_code: null,
            duplicate_of: null
          });
          return reply.code(429).send({ error: 'daily_verified_limit_exceeded' });
        } else {
          throw err;
        }
      }

      if (updated.status === 'rejected') {
        try {
          await deleteObject({ s3, bucket: updated.image_bucket, key: updated.image_key });
        } catch (err) {
          request.log.warn(
            { err, bucket: updated.image_bucket, key: updated.image_key },
            's3_delete_rejected_image_failed'
          );
        }
      }
      return reply.send({ submission: updated });
    } catch (err) {
      request.log.error({ err }, 'verification_failed');
      const updated = await repo.updateSubmission(claimed.id, {
        status: 'rejected',
        dify_raw: {
          error: 'verification_failed',
          message: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString()
        } as any,
        points_base: 0,
        points_multiplier: 1,
        points_bonus_sources: [],
        points_total: 0,
        verified_at: new Date().toISOString()
      });
      try {
        await deleteObject({ s3, bucket: updated.image_bucket, key: updated.image_key });
      } catch (deleteErr) {
        request.log.warn(
          { err: deleteErr, bucket: updated.image_bucket, key: updated.image_key },
          's3_delete_rejected_image_failed'
        );
      }
      return reply.send({ submission: updated });
    }
  });

  app.get('/submissions', { preHandler: authenticate }, async (request: any, reply) => {
    const { sub: userId } = (request as AuthedRequest).user;
    const rows = await repo.listSubmissions(userId, 50);
    return reply.send({ submissions: rows });
  });

  app.get('/submissions/:id', { preHandler: authenticate }, async (request: any, reply) => {
    const { sub: userId } = (request as AuthedRequest).user;
    const parsedParams = SubmissionIdParams.safeParse(request.params);
    if (!parsedParams.success) return reply.code(400).send({ error: 'invalid_params' });

    const submission = await repo.getSubmissionById(parsedParams.data.id);
    if (!submission || submission.user_id !== userId) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ submission });
  });

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

await main();
