import { z } from 'zod';

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim() === '' ? undefined : value;
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

    DIFY_MODE: z.enum(['mock', 'workflow']).default('workflow'),
    DIFY_API_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    DIFY_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    DIFY_WORKFLOW_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    DIFY_IMAGE_INPUT_KEY: z.string().min(1).default('image_url'),
    DIFY_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

    // Phase 2 (Rewards / On-chain B3TR claim)
    VECHAIN_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
    VECHAIN_NODE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    VEBETTER_APP_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    X2EARN_REWARDS_POOL_ADDRESS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    FEE_DELEGATION_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    REWARD_DISTRIBUTOR_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional())
  })
  .superRefine((env, ctx) => {
    if (env.DIFY_MODE === 'workflow') {
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
