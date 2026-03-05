import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Screen from '../components/Screen';
import BottomTabBar from '../components/BottomTabBar';
import { useAuth } from '../../state/auth';
import { apiGet, apiPost } from '../../util/api';

type Submission = {
  id: string;
  status: string;
  points_total: number;
  created_at: string;
};

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

function formatTokenAmount(amount: string, maxDecimals = 2): string {
  const [whole, frac] = amount.split('.');
  if (!frac) return amount;
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export default function DashboardPage() {
  const nav = useNavigate();
  const { state } = useAuth();
  const isLoading = state.status === 'loading';
  const isLoggedIn = state.status === 'logged_in';
  const token = isLoggedIn ? state.token : null;

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [quote, setQuote] = useState<RewardsQuote | null>(null);
  const [claims, setClaims] = useState<RewardClaim[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  const inflight = useMemo(() => claims.find((c) => c.status === 'pending' || c.status === 'submitted') ?? null, [claims]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token) return;
      setError(null);
      try {
        const res = await apiGet<{ submissions: Submission[] }>('/submissions', token);
        if (!cancelled) setSubmissions(res.submissions);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token) return;
      try {
        const [q, c] = await Promise.all([
          apiGet<{ quote: RewardsQuote }>('/rewards/quote', token),
          apiGet<{ claims: RewardClaim[] }>('/rewards/claims?limit=5', token)
        ]);
        if (cancelled) return;
        setQuote(q.quote);
        setClaims(c.claims);
      } catch (e) {
        if (!cancelled) return;
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const stats = useMemo(() => {
    const totalScans = submissions.length;
    const totalPoints = submissions.reduce((sum, s) => sum + (s.points_total ?? 0), 0);

    const todayKey = new Date().toISOString().slice(0, 10);
    const pointsToday = submissions
      .filter((s) => String(s.created_at).slice(0, 10) === todayKey)
      .reduce((sum, s) => sum + (s.points_total ?? 0), 0);

    return { totalScans, totalPoints, pointsToday };
  }, [submissions]);

  const walletShort =
    isLoggedIn
      ? `${state.user.wallet_address.slice(0, 6)}...${state.user.wallet_address.slice(-4)}`
      : null;

  async function refreshQuote() {
    if (!token) return;
    try {
      const [q, c] = await Promise.all([
        apiGet<{ quote: RewardsQuote }>('/rewards/quote', token),
        apiGet<{ claims: RewardClaim[] }>('/rewards/claims?limit=5', token)
      ]);
      setQuote(q.quote);
      setClaims(c.claims);
    } catch {
      // ignore
    }
  }

  async function onClaim() {
    if (!token || isClaiming || inflight) return;
    if (!quote || quote.points_available <= 0) return;

    setIsClaiming(true);
    setError(null);
    try {
      const clientClaimId = crypto.randomUUID();
      const res = await apiPost<{ claim: RewardClaim }>(
        '/rewards/claim',
        { client_claim_id: clientClaimId },
        token
      );
      setClaims((prev) => {
        const existing = prev.findIndex((c) => c.id === res.claim.id);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = res.claim;
          return next;
        }
        return [res.claim, ...prev];
      });
      await refreshQuote();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsClaiming(false);
    }
  }

  return (
    <Screen>
      <div className="relative mx-auto min-h-dvh max-w-[420px] px-5 pb-32 pt-10">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold tracking-tight">BIG BOTTLE</div>
            <div className="mt-1 text-[11px] text-white/50">B3TR Receipt MVP (Phase 1)</div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isLoading) return;
              nav('/account');
            }}
            disabled={isLoading}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/70"
          >
            {isLoading ? 'Loading' : isLoggedIn ? walletShort : 'Connect Wallet'}
          </button>
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-[10px] tracking-[0.24em] text-white/40">CLAIMABLE</div>
          <div className="mt-2 flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <div className="text-5xl font-semibold tabular-nums">
                {quote ? formatTokenAmount(quote.b3tr_amount) : '—'}
              </div>
              <div className="text-[11px] tracking-[0.22em] text-emerald-300">B3TR</div>
            </div>

            <button
              type="button"
              onClick={onClaim}
              disabled={!quote || quote.points_available <= 0 || isClaiming || Boolean(inflight) || !isLoggedIn}
              className="rounded-2xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-black shadow-[0_10px_40px_rgba(16,185,129,0.18)] transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]"
            >
              {inflight ? 'PROCESSING' : isClaiming ? 'PROCESSING…' : 'CLAIM'}
            </button>
          </div>
          {quote && quote.points_available > 0 && (
            <div className="mt-2 text-[11px] text-white/45">
              Available: {quote.points_available.toLocaleString()} points
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-[10px] tracking-[0.22em] text-white/40">TOTAL SCANS</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{stats.totalScans}</div>
            <div className="mt-1 text-[11px] text-white/45">Receipts</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-[10px] tracking-[0.22em] text-white/40">POINTS TODAY</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-300">
              +{stats.pointsToday}
            </div>
            <div className="mt-1 text-[11px] text-white/45">From bottles</div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="text-[10px] tracking-[0.22em] text-white/40">RECENT ACTIVITY</div>
          <button type="button" className="text-xs text-emerald-300/80">
            View all
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="mt-3 space-y-2">
          {submissions.slice(0, 5).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => nav(`/result/${s.id}`)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition active:scale-[0.99]"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Receipt</div>
                <div className="text-sm font-semibold text-emerald-300 tabular-nums">
                  +{s.points_total ?? 0}
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-white/50">
                <div>{new Date(s.created_at).toLocaleString()}</div>
                <div className="uppercase tracking-widest">{s.status}</div>
              </div>
            </button>
          ))}

          {submissions.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
              还没有扫描记录
            </div>
          )}
        </div>

        {!isLoggedIn && (
          <div className="fixed inset-x-0 bottom-8">
            <div className="mx-auto max-w-[420px] px-5">
              <button
                type="button"
                onClick={() => nav('/account')}
                className="w-full rounded-2xl bg-emerald-300 py-4 text-sm font-semibold text-black shadow-[0_10px_40px_rgba(16,185,129,0.18)] transition active:scale-[0.99]"
              >
                CONNECT WALLET
              </button>
              <div className="mt-2 text-center text-xs text-white/55">登录后才能扫描小票并领取积分</div>
            </div>
          </div>
        )}
      </div>

      {isLoggedIn && <BottomTabBar />}
    </Screen>
  );
}
