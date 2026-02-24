import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'crypto';
import { getAddress } from 'ethers';

import './types.js';
import { loadConfig } from './config.js';
import { buildLoginTypedData, verifyLoginSignature } from './auth.js';
import { createRepo, createSupabaseAdmin } from './supabase.js';
import { computeTotalPoints } from './scoring.js';
import { createS3Client, deleteObject, headObject, presignGetObject, presignPutObject } from './s3.js';
import { extractDifyReceiptPayload, runDify } from './dify.js';
import { isUniqueViolation } from './postgres-errors.js';

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
const AccountAchievementsQuery = z.object({
  effective_round_id: z.coerce.number().int().positive().optional()
});

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

function toSafeMultiplier(value: unknown, fallback = 1): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, n);
}

async function main() {
  const config = loadConfig();
  const supabase = createSupabaseAdmin(config);
  const repo = createRepo(supabase);
  const s3 = createS3Client(config);

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

    const unlocked = Boolean(vebetterVote);
    const multiplier = unlocked ? toSafeMultiplier(vebetterVote?.bonus_multiplier, 1) : 1;

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
        source_round_id: unlocked ? (vebetterVote?.source_round_id ?? null) : null
      }
    ];

    const totalMultiplier = achievements.reduce((acc, item) => acc * (item.unlocked ? item.multiplier : 1), 1);
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
          acl: 'public-read',
          expiresInSeconds: config.S3_PRESIGN_EXPIRES_SECONDS
        });
        return reply.send({ submission: existing, upload: { method: 'PUT', ...upload } });
      }
      return reply.send({ submission: existing, upload: null });
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
            acl: 'public-read',
            expiresInSeconds: config.S3_PRESIGN_EXPIRES_SECONDS
          });
          return reply.send({ submission: again, upload: { method: 'PUT', ...upload } });
        }
        return reply.send({ submission: again, upload: null });
      }
      throw err;
    }

    const upload = await presignPutObject({
      s3,
      bucket: created.image_bucket,
      key: created.image_key,
      contentType: created.image_content_type || contentType,
      acl: 'public-read',
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
      const { totalPoints } = computeTotalPoints(payload.drinkList);

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
          points_total: ok ? totalPoints : 0,
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
            points_total: 0,
            receipt_fingerprint: receiptFingerprint,
            rejection_code: 'duplicate_receipt',
            duplicate_of: winner?.id ?? null,
            verified_at: nowIso
          });
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
