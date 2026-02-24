import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

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
});
