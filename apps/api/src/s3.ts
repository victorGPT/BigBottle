import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from './config.js';

export function createS3Client(config: AppConfig): S3Client {
  return new S3Client({ region: config.AWS_REGION });
}

export async function presignPutObject(params: {
  s3: S3Client;
  bucket: string;
  key: string;
  contentType: string;
  expiresInSeconds: number;
  cacheControl?: string;
}): Promise<{ url: string; headers: Record<string, string> }> {
  const input: PutObjectCommandInput = {
    Bucket: params.bucket,
    Key: params.key,
    ContentType: params.contentType,
    CacheControl: params.cacheControl
  };
  const url = await getSignedUrl(params.s3, new PutObjectCommand(input), {
    expiresIn: params.expiresInSeconds
  });
  return {
    url,
    headers: {
      'Content-Type': params.contentType
    }
  };
}

export async function presignGetObject(params: {
  s3: S3Client;
  bucket: string;
  key: string;
  expiresInSeconds: number;
}): Promise<{ url: string }> {
  const url = await getSignedUrl(
    params.s3,
    new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key
    }),
    { expiresIn: params.expiresInSeconds }
  );
  return { url };
}

export async function headObject(params: {
  s3: S3Client;
  bucket: string;
  key: string;
}): Promise<{ contentLength: number | null; contentType: string | null; eTag: string | null } | null> {
  try {
    const res = await params.s3.send(
      new HeadObjectCommand({
        Bucket: params.bucket,
        Key: params.key
      })
    );
    return {
      contentLength: typeof res.ContentLength === 'number' ? res.ContentLength : null,
      contentType: typeof res.ContentType === 'string' ? res.ContentType : null,
      eTag: typeof res.ETag === 'string' ? res.ETag : null
    };
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    const name = typeof err?.name === 'string' ? err.name : '';
    // AWS SDK v3 uses different error shapes depending on runtime; we treat 404/NotFound as "missing".
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return null;
    throw err;
  }
}

export async function deleteObject(params: { s3: S3Client; bucket: string; key: string }): Promise<void> {
  try {
    await params.s3.send(
      new DeleteObjectCommand({
        Bucket: params.bucket,
        Key: params.key
      })
    );
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    const name = typeof err?.name === 'string' ? err.name : '';
    // S3 DeleteObject is idempotent, but we still treat NotFound as success for robustness.
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return;
    throw err;
  }
}
