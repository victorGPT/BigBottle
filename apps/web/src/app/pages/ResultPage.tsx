import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Screen from '../components/Screen';
import { useAuth } from '../../state/auth';
import { apiGet } from '../../util/api';

type Submission = {
  id: string;
  status: 'pending_upload' | 'uploaded' | 'verifying' | 'verified' | 'rejected' | 'not_claimable' | string;
  points_total: number;
  dify_drink_list: unknown | null;
  created_at: string;
};

function asDrinkList(value: unknown): Array<{ retinfoDrinkName?: unknown; retinfoDrinkCapacity?: unknown; retinfoDrinkAmount?: unknown }> {
  if (!Array.isArray(value)) return [];
  return value as any[];
}

export default function ResultPage() {
  const nav = useNavigate();
  const params = useParams();
  const { state } = useAuth();
  const token = state.status === 'logged_in' ? state.token : null;
  const id = params.id ?? '';

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token || !id) return;
      setError(null);
      try {
        const res = await apiGet<{ submission: Submission }>(`/submissions/${id}`, token);
        if (!cancelled) setSubmission(res.submission);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  const drinks = useMemo(() => asDrinkList(submission?.dify_drink_list ?? null), [submission?.dify_drink_list]);

  if (!submission) {
    return (
      <Screen>
        <div className="mx-auto flex min-h-dvh max-w-[420px] items-center justify-center px-5">
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-emerald-300" />
            <div className="mt-3 text-xs tracking-widest text-white/70">LOADING</div>
            {error && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            )}
          </div>
        </div>
      </Screen>
    );
  }

  const status = submission.status;
  const totalPoints = submission.points_total ?? 0;

  if (status === 'rejected') {
    return (
      <Screen>
        <div className="mx-auto flex min-h-dvh max-w-[420px] flex-col px-5 pb-10 pt-10">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => nav('/')}
              className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/80"
              aria-label="Back"
            >
              ←
            </button>
            <div className="text-xs font-semibold tracking-[0.22em] text-white/80">RESULTS</div>
            <button
              type="button"
              onClick={() => nav('/')}
              className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/70"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="mt-10 flex flex-col items-center">
            <div className="grid h-28 w-28 place-items-center rounded-full border border-red-500/40 bg-red-500/10">
              <div className="text-5xl text-red-400">×</div>
            </div>
            <div className="mt-6 text-center text-sm font-semibold tracking-[0.22em]">NO BOTTLES DETECTED</div>
            <div className="mt-2 max-w-[320px] text-center text-xs text-white/55">
              我们没有在这张小票里识别到可奖励的瓶装饮料信息。
            </div>

            <div className="mt-8 w-full rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-[10px] tracking-[0.22em] text-white/40">TIPS</div>
              <ul className="mt-3 space-y-2 text-xs text-white/70">
                <li>• Receipt contains beverage bottles</li>
                <li>• Image is clear and readable</li>
                <li>• Uploading a valid store receipt</li>
              </ul>
            </div>
          </div>

          <div className="mt-auto space-y-3">
            <button
              type="button"
              onClick={() => nav('/scan')}
              className="w-full rounded-2xl bg-emerald-300 py-4 text-sm font-semibold text-black transition active:scale-[0.99]"
            >
              TRY AGAIN
            </button>
            <button
              type="button"
              onClick={() => nav('/')}
              className="w-full rounded-2xl border border-white/15 bg-white/5 py-4 text-sm font-semibold text-white/80 transition active:scale-[0.99]"
            >
              BACK TO HOME
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  const isClaimable = status === 'verified' && totalPoints > 0;
  const isNotClaimable = status === 'not_claimable';

  return (
    <Screen>
      <div className="mx-auto flex min-h-dvh max-w-[420px] flex-col px-5 pb-10 pt-10">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => nav('/')}
            className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/80"
            aria-label="Back"
          >
            ←
          </button>
          <div className="text-xs font-semibold tracking-[0.22em] text-white/80">RESULTS</div>
          <button
            type="button"
            onClick={() => nav('/')}
            className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/70"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] tracking-[0.22em] text-white/40">DETECTED ITEMS</div>
            <div className="text-[10px] tracking-[0.22em] text-white/40">{drinks.length}</div>
          </div>

          <div className="mt-3 space-y-2">
            {drinks.map((d, idx) => {
              const name = typeof d.retinfoDrinkName === 'string' ? d.retinfoDrinkName : 'Drink';
              const cap = d.retinfoDrinkCapacity == null ? null : String(d.retinfoDrinkCapacity);
              const amt = d.retinfoDrinkAmount == null ? null : String(d.retinfoDrinkAmount);
              return (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-black/10 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-300/15 text-emerald-200">
                      ⎔
                    </div>
                    <div>
                      <div className="text-sm font-medium">{name}</div>
                      <div className="mt-0.5 text-xs text-white/55">
                        {cap ? `${cap} ml` : 'capacity unknown'} {amt ? `• x${amt}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-emerald-300 px-2 py-1 text-xs font-semibold text-black">
                    x{amt ?? '1'}
                  </div>
                </div>
              );
            })}

            {drinks.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-xs text-white/60">
                没有识别到明细(但这不代表小票无效)
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between text-xs text-white/60">
            <div>POINTS SUMMARY</div>
            <div>{new Date(submission.created_at).toLocaleString()}</div>
          </div>

          <div className="mt-4 flex items-end justify-between">
            <div className="text-[10px] tracking-[0.22em] text-white/40">TOTAL POINTS</div>
            <div className="text-4xl font-semibold tabular-nums text-emerald-300">
              {isClaimable ? `+${totalPoints}` : `${totalPoints}`}
            </div>
          </div>

          {isNotClaimable && (
            <div className="mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
              小票验证有效，但没有可奖励的瓶装容量信息，因此本次积分为 0。
            </div>
          )}
        </div>

        <div className="mt-auto space-y-3">
          <button
            type="button"
            onClick={() => nav('/')}
            className="w-full rounded-2xl bg-emerald-300 py-4 text-sm font-semibold text-black transition active:scale-[0.99]"
          >
            CONFIRM
          </button>
          <button
            type="button"
            onClick={() => nav('/scan')}
            className="w-full rounded-2xl border border-white/15 bg-white/5 py-4 text-sm font-semibold text-white/80 transition active:scale-[0.99]"
          >
            RETAKE PHOTO
          </button>
        </div>
      </div>
    </Screen>
  );
}

