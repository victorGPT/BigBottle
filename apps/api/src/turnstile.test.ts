import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyTurnstileToken } from './turnstile.js';

describe('turnstile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips verification when no secret is configured', async () => {
    const result = await verifyTurnstileToken({
      config: {},
      token: undefined,
      remoteIp: null,
      expectedAction: 'submission_init'
    });

    expect(result).toEqual({ ok: true, skipped: true });
  });

  it('requires a token when a secret is configured', async () => {
    const result = await verifyTurnstileToken({
      config: { TURNSTILE_SECRET_KEY: 'secret' },
      token: '',
      remoteIp: null,
      expectedAction: 'reward_claim'
    });

    expect(result).toEqual({ ok: false, error: 'turnstile_required' });
  });

  it('accepts valid tokens with the expected action', async () => {
    let requestBody = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        requestBody = String((init as RequestInit).body);
        return new Response(JSON.stringify({ success: true, action: 'submission_init' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      })
    );

    const result = await verifyTurnstileToken({
      config: { TURNSTILE_SECRET_KEY: 'secret' },
      token: 'token',
      remoteIp: '203.0.113.10',
      expectedAction: 'submission_init'
    });

    expect(result).toEqual({ ok: true, skipped: false });
    expect(requestBody).toContain('secret=secret');
    expect(requestBody).toContain('response=token');
    expect(requestBody).toContain('remoteip=203.0.113.10');
  });

  it('rejects tokens for a different action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, action: 'submission_init' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    );

    const result = await verifyTurnstileToken({
      config: { TURNSTILE_SECRET_KEY: 'secret' },
      token: 'token',
      remoteIp: null,
      expectedAction: 'reward_claim'
    });

    expect(result).toEqual({ ok: false, error: 'turnstile_invalid' });
  });
});
