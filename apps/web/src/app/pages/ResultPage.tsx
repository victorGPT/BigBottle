import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Screen from '../components/Screen';
import { useAuth } from '../../state/auth';
import { apiGet } from '../../util/api';

type Submission = {
  id: string;
  status: 'pending_upload' | 'uploaded' | 'verifying' | 'verified' | 'rejected' | 'not_claimable' | string;
  points_base?: number;
  points_multiplier?: number | string;
  points_bonus_sources?: unknown;
  points_total: number;
  dify_drink_list: unknown | null;
  rejection_code: string | null;
  duplicate_of: string | null;
  created_at: string;
};

function asDrinkList(value: unknown): Array<{ retinfoDrinkName?: unknown; retinfoDrinkCapacity?: unknown; retinfoDrinkAmount?: unknown }> {
  if (!Array.isArray(value)) return [];
  return value as any[];
}

function asBonusSources(value: unknown): Array<{ type?: unknown; multiplier?: unknown; name?: unknown; level?: unknown }> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object');
}

function toDisplayNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatMultiplier(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function bonusSourceLabel(source: { type?: unknown; multiplier?: unknown; name?: unknown; level?: unknown }, t: Translate): string {
  const multiplier = formatMultiplier(toDisplayNumber(source.multiplier, 1));
  if (source.type === 'gm_nft') {
    const name = typeof source.name === 'string' && source.name ? source.name : 'GM-NFT';
    return t('result.bonus.gmNft', { name, multiplier });
  }
  if (source.type === 'vebetter_vote_bonus') return t('result.bonus.voter', { multiplier });
  if (source.type === 'legacy_points_total') return t('result.bonus.legacy');
  return t('result.bonus.generic', { multiplier });
}

export default function ResultPage() {
  const nav = useNavigate();
  const params = useParams();
  const { t } = useTranslation();
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
            <div className="mt-3 text-xs tracking-widest text-white/70">{t('common.loading')}</div>
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
  const bonusSources = asBonusSources(submission.points_bonus_sources);
  const hasPointsAudit =
    submission.points_base !== undefined || submission.points_multiplier !== undefined || bonusSources.length > 0;
  const basePoints = toDisplayNumber(submission.points_base, totalPoints);
  const multiplier = toDisplayNumber(submission.points_multiplier, 1);
  const rejectionCode = submission.rejection_code;

  if (status === 'rejected' && rejectionCode === 'duplicate_receipt') {
    return (
      <Screen>
        <div className="mx-auto flex min-h-dvh max-w-[420px] flex-col px-5 pb-10 pt-10">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => nav('/')}
              className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/80"
              aria-label={t('common.back')}
            >
              ←
            </button>
            <div className="text-xs font-semibold tracking-[0.22em] text-white/80">{t('result.title')}</div>
            <button
              type="button"
              onClick={() => nav('/')}
              className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/70"
              aria-label={t('common.close')}
            >
              ✕
            </button>
          </div>

          <div className="mt-10 flex flex-col items-center">
            <div className="grid h-28 w-28 place-items-center rounded-full border border-yellow-500/40 bg-yellow-500/10">
              <div className="text-4xl text-yellow-200">!</div>
            </div>
            <div className="mt-6 text-center text-sm font-semibold tracking-[0.22em]">{t('result.receiptUsedTitle')}</div>
            <div className="mt-2 max-w-[320px] text-center text-xs text-white/55">
              {t('result.receiptUsedBody')}
            </div>

            {submission.duplicate_of && (
              <div className="mt-5 w-full rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-[10px] tracking-[0.22em] text-white/40">{t('result.details')}</div>
                <div className="mt-2 break-all text-xs text-white/65">duplicate_of: {submission.duplicate_of}</div>
              </div>
            )}
          </div>

          <div className="mt-auto space-y-3">
            <button
              type="button"
              onClick={() => nav('/scan')}
              className="w-full rounded-2xl bg-emerald-300 py-4 text-sm font-semibold text-black transition active:scale-[0.99]"
            >
              {t('result.scanNewReceipt')}
            </button>
            <button
              type="button"
              onClick={() => nav('/')}
              className="w-full rounded-2xl border border-white/15 bg-white/5 py-4 text-sm font-semibold text-white/80 transition active:scale-[0.99]"
            >
              {t('result.backToHome')}
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  if (status === 'rejected') {
    return (
      <Screen>
        <div className="mx-auto flex min-h-dvh max-w-[420px] flex-col px-5 pb-10 pt-10">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => nav('/')}
              className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/80"
              aria-label={t('common.back')}
            >
              ←
            </button>
            <div className="text-xs font-semibold tracking-[0.22em] text-white/80">{t('result.title')}</div>
            <button
              type="button"
              onClick={() => nav('/')}
              className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/70"
              aria-label={t('common.close')}
            >
              ✕
            </button>
          </div>

          <div className="mt-10 flex flex-col items-center">
            <div className="grid h-28 w-28 place-items-center rounded-full border border-red-500/40 bg-red-500/10">
              <div className="text-5xl text-red-400">×</div>
            </div>
            <div className="mt-6 text-center text-sm font-semibold tracking-[0.22em]">{t('result.noBottlesTitle')}</div>
            <div className="mt-2 max-w-[320px] text-center text-xs text-white/55">
              {t('result.noBottlesBody')}
            </div>

            <div className="mt-8 w-full rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-[10px] tracking-[0.22em] text-white/40">{t('result.tips')}</div>
              <ul className="mt-3 space-y-2 text-xs text-white/70">
                <li>• {t('result.tipContainsBottles')}</li>
                <li>• {t('result.tipReadable')}</li>
                <li>• {t('result.tipValidReceipt')}</li>
              </ul>
            </div>
          </div>

          <div className="mt-auto space-y-3">
            <button
              type="button"
              onClick={() => nav('/scan')}
              className="w-full rounded-2xl bg-emerald-300 py-4 text-sm font-semibold text-black transition active:scale-[0.99]"
            >
              {t('common.retry')}
            </button>
            <button
              type="button"
              onClick={() => nav('/')}
              className="w-full rounded-2xl border border-white/15 bg-white/5 py-4 text-sm font-semibold text-white/80 transition active:scale-[0.99]"
            >
              {t('result.backToHome')}
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
            aria-label={t('common.back')}
          >
            ←
          </button>
          <div className="text-xs font-semibold tracking-[0.22em] text-white/80">{t('result.title')}</div>
          <button
            type="button"
            onClick={() => nav('/')}
            className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/70"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] tracking-[0.22em] text-white/40">{t('result.detectedItems')}</div>
            <div className="text-[10px] tracking-[0.22em] text-white/40">{drinks.length}</div>
          </div>

          <div className="mt-3 space-y-2">
            {drinks.map((d, idx) => {
              const name = typeof d.retinfoDrinkName === 'string' ? d.retinfoDrinkName : t('result.drinkFallback');
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
                        {cap ? `${cap} ml` : t('result.capacityUnknown')} {amt ? `• x${amt}` : ''}
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
                {t('result.emptyItems')}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between text-xs text-white/60">
            <div>{t('result.pointsSummary')}</div>
            <div>{new Date(submission.created_at).toLocaleString()}</div>
          </div>

          <div className="mt-4 flex items-end justify-between">
            <div className="text-[10px] tracking-[0.22em] text-white/40">{t('result.totalPoints')}</div>
            <div className="text-4xl font-semibold tabular-nums text-emerald-300">
              {isClaimable ? `+${totalPoints}` : `${totalPoints}`}
            </div>
          </div>

          {hasPointsAudit && (
            <div className="mt-4 grid grid-cols-2 border-y border-white/10 py-3">
              <div className="border-r border-white/10 pr-3">
                <div className="text-[10px] tracking-[0.18em] text-white/40">{t('result.basePoints')}</div>
                <div className="mt-1 text-base font-semibold tabular-nums text-white">{basePoints}</div>
              </div>
              <div className="pl-3">
                <div className="text-[10px] tracking-[0.18em] text-white/40">{t('result.multiplier')}</div>
                <div className="mt-1 text-base font-semibold tabular-nums text-white">x{formatMultiplier(multiplier)}</div>
              </div>
            </div>
          )}

          {bonusSources.length > 0 && (
            <div className="mt-3 border-b border-white/10 pb-3">
              <div className="text-[10px] tracking-[0.18em] text-emerald-100/60">{t('result.rewardSources')}</div>
              <div className="mt-2 space-y-1">
                {bonusSources.map((source, idx) => (
                  <div key={idx} className="text-xs text-emerald-50/85">
                    {bonusSourceLabel(source, t)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isNotClaimable && (
            <div className="mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
              {t('result.notClaimable')}
            </div>
          )}
        </div>

        <div className="mt-auto space-y-3">
          <button
            type="button"
            onClick={() => nav('/')}
            className="w-full rounded-2xl bg-emerald-300 py-4 text-sm font-semibold text-black transition active:scale-[0.99]"
          >
            {t('common.confirm')}
          </button>
          <button
            type="button"
            onClick={() => nav('/scan')}
            className="w-full rounded-2xl border border-white/15 bg-white/5 py-4 text-sm font-semibold text-white/80 transition active:scale-[0.99]"
          >
            {t('result.retakePhoto')}
          </button>
        </div>
      </div>
    </Screen>
  );
}
