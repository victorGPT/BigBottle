import { z } from 'zod';

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim() === '' ? undefined : value;
}

function stringToBoolean(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return undefined;
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return value;
}

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    JWT_SECRET: z.string().min(16),

    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    AWS_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_PRESIGN_EXPIRES_SECONDS: z.coerce.number().int().positive().default(300),
    VEBETTER_CURRENT_EFFECTIVE_ROUND_ID: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().positive().optional()
    ),

    RECEIPT_ANALYZER_PROVIDER: z.enum(['dify', 'temporal']).default('dify'),

    DIFY_MODE: z.enum(['mock', 'workflow']).default('workflow'),
    DIFY_API_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    DIFY_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    DIFY_WORKFLOW_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    DIFY_IMAGE_INPUT_KEY: z.string().min(1).default('image_url'),
    DIFY_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

    TEMPORAL_ADDRESS: z.preprocess(emptyToUndefined, z.string().min(1).default('localhost:7233')),
    TEMPORAL_NAMESPACE: z.preprocess(emptyToUndefined, z.string().min(1).default('default')),
    TEMPORAL_TASK_QUEUE: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default('bigbottle-receipt-verification')
    ),
    TEMPORAL_WORKFLOW_TYPE: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default('receiptVerificationWorkflow')
    ),
    TEMPORAL_WORKFLOW_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
    TEMPORAL_TLS: z.preprocess(stringToBoolean, z.boolean().default(false)),
    TEMPORAL_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

    RECEIPT_MODEL_PROVIDER: z.enum(['gemini', 'siliconflow']).default('gemini'),
    GEMINI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    GEMINI_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default('gemini-2.5-flash')),
    GEMINI_API_BASE_URL: z.preprocess(
      emptyToUndefined,
      z.string().url().default('https://generativelanguage.googleapis.com')
    ),
    GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
    GEMINI_MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
    RECEIPT_MODEL_IMAGE_MAX_LONG_EDGE: z.coerce.number().int().positive().default(1024),
    RECEIPT_MODEL_IMAGE_JPEG_QUALITY: z.coerce.number().int().min(1).max(100).default(78),
    SILICONFLOW_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SILICONFLOW_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default('Qwen/Qwen3.6-35B-A3B')),
    SILICONFLOW_API_BASE_URL: z.preprocess(
      emptyToUndefined,
      z.string().url().default('https://api.siliconflow.cn/v1')
    ),
    SILICONFLOW_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

    // Phase 2 (Rewards / On-chain B3TR claim)
    REWARDS_MODE: z.enum(['chain', 'mock']).default('chain'),
    VECHAIN_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
    VECHAIN_NODE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    VEBETTER_APP_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    X2EARN_REWARDS_POOL_ADDRESS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    FEE_DELEGATION_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    REWARD_DISTRIBUTOR_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional())
  })
  .superRefine((env, ctx) => {
    if (env.RECEIPT_ANALYZER_PROVIDER === 'dify' && env.DIFY_MODE === 'workflow') {
      if (!env.DIFY_API_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DIFY_API_URL is required when DIFY_MODE=workflow',
          path: ['DIFY_API_URL']
        });
      }
      if (!env.DIFY_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DIFY_API_KEY is required when DIFY_MODE=workflow',
          path: ['DIFY_API_KEY']
        });
      }
      if (!env.DIFY_WORKFLOW_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DIFY_WORKFLOW_ID is required when DIFY_MODE=workflow',
          path: ['DIFY_WORKFLOW_ID']
        });
      }
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}

const TemporalWorkerEnvSchema = z.object({
  TEMPORAL_ADDRESS: z.preprocess(emptyToUndefined, z.string().min(1).default('localhost:7233')),
  TEMPORAL_NAMESPACE: z.preprocess(emptyToUndefined, z.string().min(1).default('default')),
  TEMPORAL_TASK_QUEUE: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default('bigbottle-receipt-verification')
  ),
  TEMPORAL_WORKFLOW_TYPE: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default('receiptVerificationWorkflow')
  ),
  TEMPORAL_WORKFLOW_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  TEMPORAL_TLS: z.preprocess(stringToBoolean, z.boolean().default(false)),
  TEMPORAL_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  RECEIPT_MODEL_PROVIDER: z.enum(['gemini', 'siliconflow']).default('gemini'),
  GEMINI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GEMINI_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default('gemini-2.5-flash')),
  GEMINI_API_BASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default('https://generativelanguage.googleapis.com')
  ),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  GEMINI_MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  RECEIPT_MODEL_IMAGE_MAX_LONG_EDGE: z.coerce.number().int().positive().default(1024),
  RECEIPT_MODEL_IMAGE_JPEG_QUALITY: z.coerce.number().int().min(1).max(100).default(78),
  SILICONFLOW_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SILICONFLOW_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default('Qwen/Qwen3.6-35B-A3B')),
  SILICONFLOW_API_BASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default('https://api.siliconflow.cn/v1')
  ),
  SILICONFLOW_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000)
}).superRefine((env, ctx) => {
  if (env.RECEIPT_MODEL_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'GEMINI_API_KEY is required when RECEIPT_MODEL_PROVIDER=gemini',
      path: ['GEMINI_API_KEY']
    });
  }
  if (env.RECEIPT_MODEL_PROVIDER === 'siliconflow' && !env.SILICONFLOW_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'SILICONFLOW_API_KEY is required when RECEIPT_MODEL_PROVIDER=siliconflow',
      path: ['SILICONFLOW_API_KEY']
    });
  }
});

export type TemporalWorkerConfig = z.infer<typeof TemporalWorkerEnvSchema>;

export function loadTemporalWorkerConfig(env: NodeJS.ProcessEnv = process.env): TemporalWorkerConfig {
  return TemporalWorkerEnvSchema.parse(env);
}

const TemporalBridgeEnvSchema = TemporalWorkerEnvSchema.extend({
  ANALYZER_BRIDGE_PORT: z.coerce.number().int().positive().default(8084),
  ANALYZER_BRIDGE_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional())
});

export type TemporalBridgeConfig = z.infer<typeof TemporalBridgeEnvSchema>;

export function loadTemporalBridgeConfig(env: NodeJS.ProcessEnv = process.env): TemporalBridgeConfig {
  return TemporalBridgeEnvSchema.parse(env);
}
