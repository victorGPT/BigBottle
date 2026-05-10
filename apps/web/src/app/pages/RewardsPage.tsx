import Screen from '../components/Screen';
import BottomTabBar from '../components/BottomTabBar';
import ClaimStatusPanel, { getClaimButtonLabel } from '../components/ClaimStatusPanel';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../state/auth';
import { apiGet, apiPost } from '../../util/api';

type RewardsQuote = {
  points_total: number;
  points_locked: number;
  points_available: number;
  points_per_b3tr: number;
  conversion_rate_id: string;
  b3tr_amount_wei: string;
  b3tr_amount: string;
};

type RewardClaim = {
  id: string;
  client_claim_id: string;
  wallet_address: string;
  conversion_rate_id: string;
  points_per_b3tr_snapshot: number;
  points_claimed: number;
  b3tr_amount_wei: string;
  b3tr_amount: string;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  tx_hash: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

function formatTokenAmount(amount: string, maxDecimals = 4): string {
  const [whole, frac] = amount.split('.');
  if (!frac) return amount;
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function shortHash(hash: string): string {
  const h = hash.trim();
  if (h.length <= 14) return h;
  return `${h.slice(0, 10)}...${h.slice(-4)}`;
}

export default function RewardsPage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const token = state.status === 'logged_in' ? state.token : null;

  const [quote, setQuote] = useState<RewardsQuote | null>(null);
  const [claims, setClaims] = useState<RewardClaim[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [settledClaim, setSettledClaim] = useState<RewardClaim | null>(null);

  const inflight = useMemo(() => claims.find((c) => c.status === 'pending' || c.status === 'submitted') ?? null, [claims]);
  const claimStatus = inflight ?? settledClaim;
  const claimButtonLabel = getClaimButtonLabel({
    inflight,
    isClaiming,
    settledClaim,
    pointsAvailable: quote?.points_available ?? null,
    claimingLabel: t('claim.action.claiming'),
    labels: {
      claim: t('claim.action.claim'),
      claimed: t('claim.action.claimed'),
      processing: t('claim.action.processing')
    }
  });

  async function refreshAll() {
    if (!token) return;
    setError(null);
    const [q, c] = await Promise.all([
      apiGet<{ quote: RewardsQuote }>('/rewards/quote', token),
      apiGet<{ claims: RewardClaim[] }>('/rewards/claims?limit=20', token)
    ]);
    setQuote(q.quote);
    setClaims(c.claims);
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token) return;
      try {
        const [q, c] = await Promise.all([
          apiGet<{ quote: RewardsQuote }>('/rewards/quote', token),
          apiGet<{ claims: RewardClaim[] }>('/rewards/claims?limit=20', token)
        ]);
        if (cancelled) return;
        setQuote(q.quote);
        setClaims(c.claims);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (!inflight) return;

    const id = inflight.id;
    let cancelled = false;
    const t = window.setInterval(async () => {
      try {
        const res = await apiGet<{ claim: RewardClaim }>(`/rewards/claims/${id}`, token);
        if (cancelled) return;
        setClaims((prev) => prev.map((c) => (c.id === id ? res.claim : c)));
        if (res.claim.status === 'confirmed' || res.claim.status === 'failed') {
          setSettledClaim(res.claim);
          window.clearInterval(t);
          await refreshAll();
        }
      } catch {
        // Ignore polling errors.
      }
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [token, inflight, inflight?.id]);

  async function onClaim() {
    if (!token) return;
    if (isClaiming) return;
    if (inflight) return;
    if (!quote || quote.points_available <= 0) return;

    setIsClaiming(true);
    setSettledClaim(null);
    setError(null);
    try {
      const clientClaimId = crypto.randomUUID();
      const res = await apiPost<{ claim: RewardClaim }>(
        '/rewards/claim',
        { client_claim_id: clientClaimId },
        token
      );
      setClaims((prev) => {
        const existingIdx = prev.findIndex((c) => c.id === res.claim.id);
        if (existingIdx >= 0) {
          const copy = [...prev];
          copy[existingIdx] = res.claim;
          return copy;
        }
        return [res.claim, ...prev];
      });
      if (res.claim.status === 'confirmed' || res.claim.status === 'failed') {
        setSettledClaim(res.claim);
      }
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsClaiming(false);
    }
  }

  return (
    <Screen>
      <div className="mx-auto min-h-dvh max-w-[420px] px-5 pb-32 pt-10">
        <div className="text-lg font-semibold tracking-tight">{t('common.rewards')}</div>
        <div className="mt-1 text-[11px] text-white/50">{t('rewards.subtitle')}</div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-[10px] tracking-[0.24em] text-white/40">{t('dashboard.claimable')}</div>
          <div className="mt-2 flex items-baseline justify-between">
            <div>
              <div className="text-4xl font-semibold tabular-nums">
                {quote ? formatTokenAmount(quote.b3tr_amount, 6) : '—'}
              </div>
              <div className="mt-1 text-[11px] tracking-[0.22em] text-emerald-300">B3TR</div>
            </div>

            <button
              type="button"
              onClick={onClaim}
              disabled={!quote || quote.points_available <= 0 || isClaiming || Boolean(inflight)}
              className="rounded-2xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-black shadow-[0_10px_40px_rgba(16,185,129,0.18)] transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]"
            >
              {claimButtonLabel}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[10px] tracking-[0.22em] text-white/40">{t('rewards.total')}</div>
              <div className="mt-2 text-lg font-semibold tabular-nums">{quote ? quote.points_total : '—'}</div>
              <div className="mt-1 text-[11px] text-white/45">{t('common.points')}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[10px] tracking-[0.22em] text-white/40">{t('rewards.locked')}</div>
              <div className="mt-2 text-lg font-semibold tabular-nums">{quote ? quote.points_locked : '—'}</div>
              <div className="mt-1 text-[11px] text-white/45">{t('rewards.inClaims')}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[10px] tracking-[0.22em] text-white/40">{t('rewards.available')}</div>
              <div className="mt-2 text-lg font-semibold tabular-nums text-emerald-300">
                {quote ? quote.points_available : '—'}
              </div>
              <div className="mt-1 text-[11px] text-white/45">{t('rewards.toClaim')}</div>
            </div>
          </div>

          <div className="mt-4 text-xs text-white/55">
            {t('rewards.exchangeRate', { points: quote ? quote.points_per_b3tr : '—' })}
          </div>
          <div className="mt-1 text-[11px] text-white/45">
            {t('rewards.gasCovered')}
          </div>
        </div>

        {claimStatus && <ClaimStatusPanel claim={claimStatus} className="mt-4 rounded-3xl bg-white/5 p-5" />}

        <div className="mt-6 flex items-center justify-between">
          <div className="text-[10px] tracking-[0.22em] text-white/40">{t('rewards.claimHistory')}</div>
          <button type="button" onClick={refreshAll} className="text-xs text-emerald-300/80">
            {t('common.refresh')}
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {claims.map((c) => (
            <div key={c.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  {c.status === 'confirmed'
                    ? t('rewards.status.confirmed')
                    : c.status === 'failed'
                      ? t('rewards.status.failed')
                      : c.status === 'submitted'
                        ? t('rewards.status.submitted')
                        : t('rewards.status.pending')}
                </div>
                <div className="text-sm font-semibold text-emerald-300 tabular-nums">
                  {formatTokenAmount(c.b3tr_amount, 6)} B3TR
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-white/50">
                <div>{new Date(c.created_at).toLocaleString()}</div>
                <div className="flex items-center gap-2">
                  <div className="tabular-nums">{c.points_claimed} pts</div>
                  {c.tx_hash && <div className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">{shortHash(c.tx_hash)}</div>}
                </div>
              </div>
              {c.status === 'failed' && c.failure_reason && (
                <div className="mt-2 text-[11px] text-red-200/80">
                  {c.failure_reason}
                </div>
              )}
            </div>
          ))}

          {claims.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
              {t('rewards.emptyClaims')}
            </div>
          )}
        </div>
      </div>

      <BottomTabBar />
    </Screen>
  );
}
