import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Screen from '../components/Screen';
import { useAuth } from '../../state/auth';
import { apiGet, apiPost } from '../../util/api';
import {
  clearVeWorldWalletLinkState,
  completeVeWorldConnectedCallback,
  completeVeWorldSignedTypedDataCallback,
  createVeWorldTypedDataUrl,
  openVeWorldWalletLink,
  type VeWorldChallenge
} from '../../util/veworldWalletLink';

type VerifyResponse = {
  access_token: string;
  user: { id: string; wallet_address: string; created_at: string };
};

type CallbackOutcome =
  | { type: 'open-veworld'; url: string }
  | { type: 'authenticated'; accessToken: string; user: VerifyResponse['user'] };

const callbackRuns = new Map<string, Promise<CallbackOutcome>>();

function runCallbackOnce(url: string): Promise<CallbackOutcome> {
  const existing = callbackRuns.get(url);
  if (existing) return existing;

  const run = handleCallback(url);
  callbackRuns.set(url, run);
  return run;
}

async function handleCallback(url: string): Promise<CallbackOutcome> {
  if (url.includes('/onVeWorldConnected')) {
    const { address } = completeVeWorldConnectedCallback(url);
    const challenge = await apiPost<VeWorldChallenge>('/auth/challenge', { address }, null);
    return { type: 'open-veworld', url: createVeWorldTypedDataUrl(challenge) };
  }

  if (url.includes('/onVeWorldSignedTypedData')) {
    const signed = completeVeWorldSignedTypedDataCallback(url);
    const verify = await apiPost<VerifyResponse>(
      '/auth/verify',
      { challenge_id: signed.challengeId, signature: signed.signature },
      null
    );
    await apiGet<{ user: VerifyResponse['user'] }>('/me', verify.access_token);
    clearVeWorldWalletLinkState();
    return { type: 'authenticated', accessToken: verify.access_token, user: verify.user };
  }

  throw new Error('veworld:unknown_callback');
}

export default function VeWorldCallbackPage() {
  const nav = useNavigate();
  const { t } = useTranslation();
  const { setToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'connecting' | 'signing'>('connecting');
  const appliedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const url = window.location.href;
        if (url.includes('/onVeWorldConnected')) {
          setMode('connecting');
        } else if (url.includes('/onVeWorldSignedTypedData')) {
          setMode('signing');
        }

        const outcome = await runCallbackOnce(url);
        if (cancelled || appliedUrlRef.current === url) return;
        appliedUrlRef.current = url;

        if (outcome.type === 'open-veworld') {
          openVeWorldWalletLink(outcome.url);
          return;
        }

        if (outcome.type === 'authenticated') {
          await setToken(outcome.accessToken, outcome.user);
          nav('/', { replace: true });
          return;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [nav, setToken]);

  const title = error
    ? t('veworldLink.errorTitle')
    : mode === 'connecting'
      ? t('veworldLink.connectingTitle')
      : t('veworldLink.signingTitle');

  const body = error
    ? t('veworldLink.errorBody')
    : mode === 'connecting'
      ? t('veworldLink.connectingBody')
      : t('veworldLink.signingBody');

  return (
    <Screen>
      <div className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center px-6 py-10 text-center">
        {!error && (
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-emerald-300" />
        )}
        <h1 className="mt-5 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-white/60">{body}</p>
        {error && (
          <>
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
            <button
              type="button"
              onClick={() => {
                clearVeWorldWalletLinkState();
                nav('/account', { replace: true });
              }}
              className="mt-5 rounded-2xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-black"
            >
              {t('veworldLink.backToAccount')}
            </button>
          </>
        )}
      </div>
    </Screen>
  );
}
