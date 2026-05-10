import { useEffect, useState } from 'react';
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

export default function VeWorldCallbackPage() {
  const nav = useNavigate();
  const { t } = useTranslation();
  const { setToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'connecting' | 'signing'>('connecting');

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const url = window.location.href;
        if (url.includes('/onVeWorldConnected')) {
          setMode('connecting');
          const { address } = completeVeWorldConnectedCallback(url);
          const challenge = await apiPost<VeWorldChallenge>('/auth/challenge', { address }, null);
          if (cancelled) return;
          openVeWorldWalletLink(createVeWorldTypedDataUrl(challenge));
          return;
        }

        if (url.includes('/onVeWorldSignedTypedData')) {
          setMode('signing');
          const signed = completeVeWorldSignedTypedDataCallback(url);
          const verify = await apiPost<VerifyResponse>(
            '/auth/verify',
            { challenge_id: signed.challengeId, signature: signed.signature },
            null
          );
          await apiGet<{ user: VerifyResponse['user'] }>('/me', verify.access_token);
          if (cancelled) return;
          clearVeWorldWalletLinkState();
          await setToken(verify.access_token, verify.user);
          nav('/', { replace: true });
          return;
        }

        throw new Error('veworld:unknown_callback');
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
