import type { AppConfig } from './config.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileAction = 'submission_init' | 'reward_claim';

export type TurnstileVerifyResult =
  | { ok: true; skipped: boolean }
  | { ok: false; error: 'turnstile_required' | 'turnstile_invalid' | 'turnstile_unavailable' };

type TurnstileResponse = {
  success?: boolean;
  action?: string;
  'error-codes'?: string[];
};

export async function verifyTurnstileToken(input: {
  config: Pick<AppConfig, 'TURNSTILE_SECRET_KEY'>;
  token: string | null | undefined;
  remoteIp: string | null;
  expectedAction: TurnstileAction;
}): Promise<TurnstileVerifyResult> {
  const secret = input.config.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };

  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (!token) return { ok: false, error: 'turnstile_required' };

  const body = new URLSearchParams({
    secret,
    response: token
  });
  if (input.remoteIp) body.set('remoteip', input.remoteIp);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal
    });
    if (!res.ok) return { ok: false, error: 'turnstile_unavailable' };
    const payload = (await res.json()) as TurnstileResponse;
    if (!payload.success) return { ok: false, error: 'turnstile_invalid' };
    if (payload.action && payload.action !== input.expectedAction) {
      return { ok: false, error: 'turnstile_invalid' };
    }
    return { ok: true, skipped: false };
  } catch {
    return { ok: false, error: 'turnstile_unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}
