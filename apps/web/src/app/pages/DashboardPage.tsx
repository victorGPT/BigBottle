import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Screen from '../components/Screen';
import { useAuth } from '../../state/auth';
import { apiGet } from '../../util/api';

type Submission = {
  id: string;
  status: string;
  points_total: number;
  created_at: string;
};

export default function DashboardPage() {
  const nav = useNavigate();
  const { state, logout } = useAuth();
  const token = state.status === 'logged_in' ? state.token : null;

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    state.status === 'logged_in'
      ? `${state.user.wallet_address.slice(0, 6)}...${state.user.wallet_address.slice(-4)}`
      : null;

  return (
    <Screen>
      <div className="relative mx-auto min-h-dvh max-w-[420px] px-5 pb-10 pt-10">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold tracking-tight">BIG BOTTLE</div>
            <div className="mt-1 text-[11px] text-white/50">B3TR Receipt MVP (Phase 1)</div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/70"
          >
            {walletShort ?? 'Logout'}
          </button>
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-[10px] tracking-[0.24em] text-white/40">POINT BALANCE</div>
          <div className="mt-2 flex items-baseline gap-2">
            <div className="text-5xl font-semibold tabular-nums">{stats.totalPoints.toLocaleString()}</div>
            <div className="text-[11px] tracking-[0.22em] text-emerald-300">POINTS</div>
          </div>
          <div className="mt-2 text-[11px] text-white/45">
            代币兑换与领取在 Phase 2 上链后开放
          </div>
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

        <button
          type="button"
          onClick={() => nav('/scan')}
          className="fixed bottom-8 left-1/2 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full border border-emerald-200/30 bg-emerald-300 text-black shadow-[0_10px_40px_rgba(16,185,129,0.25)] transition active:scale-[0.98]"
          aria-label="Scan receipt"
        >
          <span className="text-xl font-black">⌁</span>
        </button>
      </div>
    </Screen>
  );
}

