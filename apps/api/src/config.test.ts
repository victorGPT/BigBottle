import { describe, expect, it } from 'vitest';

import { loadConfig, loadTemporalWorkerConfig } from './config.js';

function baseEnv(): NodeJS.ProcessEnv {
  return {
    JWT_SECRET: 'change-me-change-me',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    AWS_REGION: 'ap-northeast-1',
    S3_BUCKET: 'example-bucket'
  };
}

describe('loadConfig', () => {
  it('accepts blank Dify fields when DIFY_MODE=mock', () => {
    const cfg = loadConfig({
      ...baseEnv(),
      DIFY_MODE: 'mock',
      DIFY_API_URL: '',
      DIFY_API_KEY: '',
      DIFY_WORKFLOW_ID: ''
    });

    expect(cfg.DIFY_MODE).toBe('mock');
    expect(cfg.DIFY_API_URL).toBeUndefined();
    expect(cfg.DIFY_API_KEY).toBeUndefined();
    expect(cfg.DIFY_WORKFLOW_ID).toBeUndefined();
  });

  it('requires Dify fields when DIFY_MODE=workflow', () => {
    expect(() =>
      loadConfig({
        ...baseEnv(),
        DIFY_MODE: 'workflow',
        DIFY_API_URL: '',
        DIFY_API_KEY: '',
        DIFY_WORKFLOW_ID: ''
      })
    ).toThrow();
  });

  it('accepts Temporal analyzer config without Dify workflow fields', () => {
    const cfg = loadConfig({
      ...baseEnv(),
      RECEIPT_ANALYZER_PROVIDER: 'temporal',
      DIFY_MODE: 'workflow',
      DIFY_API_URL: '',
      DIFY_API_KEY: '',
      DIFY_WORKFLOW_ID: '',
      TEMPORAL_ADDRESS: 'temporal.example.com:7233',
      TEMPORAL_NAMESPACE: 'bigbottle.prod',
      TEMPORAL_TASK_QUEUE: 'receipt-worker',
      TEMPORAL_WORKFLOW_TYPE: 'receiptVerificationWorkflow',
      TEMPORAL_TLS: 'true',
      TEMPORAL_API_KEY: 'temporal-api-key'
    });

    expect(cfg.RECEIPT_ANALYZER_PROVIDER).toBe('temporal');
    expect(cfg.DIFY_API_URL).toBeUndefined();
    expect(cfg.TEMPORAL_ADDRESS).toBe('temporal.example.com:7233');
    expect(cfg.TEMPORAL_NAMESPACE).toBe('bigbottle.prod');
    expect(cfg.TEMPORAL_TASK_QUEUE).toBe('receipt-worker');
    expect(cfg.TEMPORAL_WORKFLOW_TYPE).toBe('receiptVerificationWorkflow');
    expect(cfg.TEMPORAL_TLS).toBe(true);
    expect(cfg.TEMPORAL_API_KEY).toBe('temporal-api-key');
    expect(cfg.GEMINI_MODEL).toBe('gemini-2.5-flash');
    expect(cfg.GEMINI_API_BASE_URL).toBe('https://generativelanguage.googleapis.com');
    expect(cfg.SILICONFLOW_MODEL).toBe('Qwen/Qwen3-VL-32B-Instruct');
    expect(cfg.RECEIPT_MODEL_IMAGE_MAX_LONG_EDGE).toBe(1024);
    expect(cfg.RECEIPT_MODEL_IMAGE_JPEG_QUALITY).toBe(78);
  });

  it('parses optional current effective round id when positive integer', () => {
    const cfg = loadConfig({
      ...baseEnv(),
      DIFY_MODE: 'mock',
      VEBETTER_CURRENT_EFFECTIVE_ROUND_ID: '12'
    });

    expect(cfg.VEBETTER_CURRENT_EFFECTIVE_ROUND_ID).toBe(12);
  });

  it('rejects invalid current effective round id', () => {
    expect(() =>
      loadConfig({
        ...baseEnv(),
        DIFY_MODE: 'mock',
        VEBETTER_CURRENT_EFFECTIVE_ROUND_ID: '0'
      })
    ).toThrow();
  });

  it('loads Temporal worker config without API-only env vars', () => {
    const cfg = loadTemporalWorkerConfig({
      GEMINI_API_KEY: 'gemini-key',
      TEMPORAL_TLS: '1'
    });

    expect(cfg.GEMINI_API_KEY).toBe('gemini-key');
    expect(cfg.TEMPORAL_ADDRESS).toBe('localhost:7233');
    expect(cfg.TEMPORAL_NAMESPACE).toBe('default');
    expect(cfg.TEMPORAL_TLS).toBe(true);
    expect(cfg.SILICONFLOW_MODEL).toBe('Qwen/Qwen3-VL-32B-Instruct');
    expect(cfg.RECEIPT_MODEL_IMAGE_MAX_LONG_EDGE).toBe(1024);
    expect(cfg.RECEIPT_MODEL_IMAGE_JPEG_QUALITY).toBe(78);
  });
});
