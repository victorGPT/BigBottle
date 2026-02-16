import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@vechain/dapp-kit-react';
import { Progress } from '@base-ui/react/progress';
import { Coins, LifeBuoy, ReceiptText } from 'lucide-react';

import Screen from '../components/Screen';
import BottomTabBar from '../components/BottomTabBar';
import { useAuth } from '../../state/auth';
import { apiGet, apiPost } from '../../util/api';

type TypedDataMessage = {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  value: Record<string, unknown>;
};

type ChallengeResponse = {
  challenge_id: string;
  typed_data: TypedDataMessage;
};

type VerifyResponse = {
  access_token: string;
  user: { id: string; wallet_address: string; created_at: string };
};

type AccountSummary = {
  points_total: number;
  level: null;
};

export default function AccountPage() {
  const nav = useNavigate();
  const { state, setToken, logout } = useAuth();
  const { connect, setSource, account, source, requestTypedData } = useWallet();

  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [hasVeWorld, setHasVeWorld] = useState(() => {
    // DAppKit considers VeWorld "installed" when window.vechain exists.
    return typeof window !== 'undefined' && Boolean((window as unknown as { vechain?: unknown }).vechain);
  });

  useEffect(() => {
    if (hasVeWorld) return;

    // Some environments may inject `window.vechain` slightly after initial load.
    // Poll briefly to avoid permanently disabling login.
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const injected = Boolean((window as unknown as { vechain?: unknown }).vechain);
      if (injected) {
        window.clearInterval(timer);
        setHasVeWorld(true);
        return;
      }
      if (tries >= 20) window.clearInterval(timer);
    }, 250);

    return () => window.clearInterval(timer);
  }, [hasVeWorld]);

  useEffect(() => {
    if (!hasVeWorld) return;
    // Enforce VeWorld only (MVP). Guard to avoid crashing in unsupported environments.
    try {
      setSource('veworld');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, [hasVeWorld, setSource]);

  const connectedAddress = useMemo(() => (account ? String(account) : null), [account]);
  const isLoggedIn = state.status === 'logged_in';
  const walletAddress = isLoggedIn ? state.user.wallet_address : null;
  const token = isLoggedIn ? state.token : null;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token) return;
      setSummaryError(null);
      try {
        const res = await apiGet<{ summary: AccountSummary }>('/account/summary', token);
        if (!cancelled) setSummary(res.summary);
      } catch (e) {
        if (!cancelled) setSummaryError(e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onLogin() {
    setError(null);
    if (!hasVeWorld) {
      setError('未检测到 VeWorld。请使用 VeWorld 打开此页面后再登录。');
      return;
    }
    setIsBusy(true);
    try {
      // Ensure source is set, even if the first render happened before injection.
      if (source !== 'veworld') setSource('veworld');
      const res = await connect();
      const addr = (res?.account ?? connectedAddress) as string | null;
      if (!addr) throw new Error('wallet_not_connected');

      // VeWorld iOS in-app browser can be flaky when multiple signing requests are fired back-to-back.
      // Yield to the event loop briefly before starting the typed-data signing flow.
      await new Promise((resolve) => window.setTimeout(resolve, 450));

      const challenge = await apiPost<ChallengeResponse>('/auth/challenge', { address: addr }, null);

      const signTypedData = async (domain: Record<string, unknown>) =>
        requestTypedData(domain, challenge.typed_data.types, challenge.typed_data.value, {
          signer: addr
        });

      let sig: string;
      try {
        sig = await signTypedData(challenge.typed_data.domain);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const hasChainId = Object.prototype.hasOwnProperty.call(challenge.typed_data.domain, 'chainId');
        const shouldRetryWithoutChainId = hasChainId && msg.toLowerCase().includes('invalid signed data message');

        if (!shouldRetryWithoutChainId) throw e;

        const { chainId: _unused, ...domainWithoutChainId } = challenge.typed_data.domain;
        sig = await signTypedData(domainWithoutChainId);
      }

      const verify = await apiPost<VerifyResponse>(
        '/auth/verify',
        { challenge_id: challenge.challenge_id, signature: sig },
        null
      );

      setToken(verify.access_token);
      nav('/', { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setIsBusy(false);
    }
  }

  const pointsText = isLoggedIn
    ? summary
      ? summary.points_total.toLocaleString()
      : '—'
    : '****';

  return (
    <Screen>
      <div className={`mx-auto flex min-h-dvh max-w-[420px] flex-col px-5 pt-10 ${isLoggedIn ? 'pb-32' : 'pb-7'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xl font-semibold tracking-tight">Account</div>
            <div className="mt-1 text-xs text-white/50">Manage your profile</div>
          </div>
          <div className="h-10 w-10 rounded-full border border-white/10 bg-white/5" />
        </div>

        <div className="mt-6 rounded-2xl border border-[#1E3A1E] bg-[#0F1F0F]/60 p-4">
          <div className="text-[10px] font-semibold tracking-[0.24em] text-white/40">TOTAL POINTS</div>
          <div className="mt-2 flex items-baseline gap-2">
            <div className="text-4xl font-semibold tabular-nums">{pointsText}</div>
            <div className="text-[11px] font-semibold tracking-[0.22em] text-emerald-300">PTS</div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/45">
            <div className="font-mono tracking-wider">LEVEL —</div>
            <div className="text-white/35">Coming soon</div>
          </div>
          <Progress.Root
            value={null}
            aria-label="Level progress"
            aria-valuetext="Coming soon"
            className="mt-3 w-full"
          >
            <Progress.Track className="h-2 w-full overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
              <Progress.Indicator className="h-full w-full bg-gradient-to-r from-emerald-300/35 via-emerald-200/15 to-emerald-300/35 animate-pulse" />
            </Progress.Track>
          </Progress.Root>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: 'Receipts', icon: ReceiptText },
            { label: 'Points', icon: Coins },
            { label: 'Support', icon: LifeBuoy }
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-[#1E3A1E] bg-[#0F1F0F]/40 px-3 py-4 text-center text-xs text-white/80"
            >
              <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-xl bg-[#1E3A1E]">
                <item.icon size={16} className="text-white" />
              </div>
              <div className="mt-2 text-[11px] font-medium text-white/80">{item.label}</div>
            </div>
          ))}
        </div>


        <div className="mt-auto">
          {isLoggedIn ? (
            <>
              {summaryError && (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {summaryError}
                </div>
              )}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-[10px] tracking-[0.24em] text-white/40">CONNECTED</div>
                <div className="mt-2 break-all text-xs text-white/70">{walletAddress}</div>
              </div>

              <button
                type="button"
                onClick={() => {
                  logout();
                  nav('/', { replace: true });
                }}
                className="mt-4 w-full rounded-2xl border border-white/15 bg-white/5 py-4 text-sm font-semibold text-white/80 transition active:scale-[0.99]"
              >
                LOG OUT
              </button>
            </>
          ) : (
            <>
              <div className="text-center text-sm font-medium">登录以管理账户</div>
              <div className="mt-1 text-center text-xs text-white/55">
                登录后可查看积分与等级、管理账户信息
              </div>

              {error && (
                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={onLogin}
                disabled={isBusy || !hasVeWorld}
                className="mt-5 w-full rounded-2xl bg-[#F59E0B] py-4 text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-60"
              >
                {isBusy ? '登录中...' : '立即登录'}
              </button>

              <div className="mt-3 text-center text-[11px] text-white/45">
                请使用 VeWorld 打开此应用完成登录
              </div>
            </>
          )}
        </div>
      </div>

      {isLoggedIn && <BottomTabBar />}
    </Screen>
  );
}
