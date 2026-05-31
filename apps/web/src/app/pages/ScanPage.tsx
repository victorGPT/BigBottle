import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Progress } from '@base-ui/react/progress';
import { useTranslation } from 'react-i18next';
import Screen from '../components/Screen';
import { useAuth } from '../../state/auth';
import { apiPost } from '../../util/api';
import { compressReceiptImage } from '../../util/receiptImageCompression';
import { getTurnstileToken } from '../../util/turnstile';

type Submission = {
  id: string;
  status: string;
  image_bucket: string;
  image_key: string;
  points_total: number;
  created_at: string;
};

type InitResponse = {
  submission: Submission;
  upload:
    | null
    | {
        method: 'PUT';
        url: string;
        headers: Record<string, string>;
      };
};

export default function ScanPage() {
  const nav = useNavigate();
  const { t } = useTranslation();
  const { state } = useAuth();
  const token = state.status === 'logged_in' ? state.token : null;

  const progressTimerRef = useRef<number | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<'idle' | 'compressing' | 'uploading' | 'verifying' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progressValue, setProgressValue] = useState<number>(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const stopProgressTimer = useCallback(() => {
    if (progressTimerRef.current == null) return;
    window.clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;
  }, []);

  useEffect(() => {
    const spec =
      phase === 'compressing'
        ? { startMs: Date.now(), durationMs: 1_200, startValue: 8, endValue: 34 }
        : phase === 'uploading'
          ? { startMs: Date.now(), durationMs: 3_000, startValue: 40, endValue: 58 }
          : phase === 'verifying'
            ? { startMs: Date.now(), durationMs: 10_000, startValue: 62, endValue: 95 }
            : null;

    if (!spec) {
      stopProgressTimer();
      return;
    }

    stopProgressTimer();
    setProgressValue((v) => (spec.startValue > v ? spec.startValue : v));
    progressTimerRef.current = window.setInterval(() => {
      const elapsedMs = Date.now() - spec.startMs;
      const t = Math.min(1, elapsedMs / spec.durationMs);

      // Ease out so it feels responsive early, but doesn't look stuck at the end.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(spec.startValue + eased * (spec.endValue - spec.startValue));

      setProgressValue((v) => (next > v ? next : v));

      if (t >= 1) stopProgressTimer();
    }, 200);

    return stopProgressTimer;
  }, [phase, stopProgressTimer]);

  useEffect(() => {
    return () => {
      stopProgressTimer();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl, stopProgressTimer]);

  async function uploadAndVerify(file: File) {
    if (!token) throw new Error('unauthorized');

    stopProgressTimer();
    setProgressValue(0);

    setError(null);
    setPhase('compressing');
    const compressed = await compressReceiptImage(file);
    const uploadFile = compressed.file;
    setProgressValue(36);

    setPhase('uploading');

    const clientSubmissionId = crypto.randomUUID();
    const turnstileToken = await getTurnstileToken('submission_init');
    const init = await apiPost<InitResponse>(
      '/submissions/init',
      {
        client_submission_id: clientSubmissionId,
        content_type: uploadFile.type || 'application/octet-stream',
        ...(turnstileToken ? { turnstile_token: turnstileToken } : {})
      },
      token
    );
    setProgressValue(48);

    if (init.upload) {
      const tryUpload = async (headers: Record<string, string>) => {
        return fetch(init.upload!.url, {
          method: init.upload!.method,
          headers,
          body: uploadFile
        });
      };

      let res = await tryUpload(init.upload.headers);

      // Some S3 buckets still require object ACLs from presigned-browser uploads,
      // while others reject them. If we get 403, retry once with `x-amz-acl`.
      if (!res.ok && res.status === 403) {
        const retryHeaders = { ...init.upload.headers, 'x-amz-acl': 'public-read' };
        res = await tryUpload(retryHeaders);
      }

      if (!res.ok) throw new Error(`upload_failed:${res.status}`);
    }
    setProgressValue(56);

    await apiPost(`/submissions/${init.submission.id}/complete`, {}, token);

    setPhase('verifying');
    setProgressValue(62);
    await apiPost(`/submissions/${init.submission.id}/verify`, {}, token);

    stopProgressTimer();
    setProgressValue(100);

    nav(`/result/${init.submission.id}`, { replace: true });
  }

  async function onFileSelected(file: File | null) {
    if (!file) return;
    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return nextPreviewUrl;
    });
    try {
      await uploadAndVerify(file);
    } catch (e) {
      stopProgressTimer();
      setProgressValue(0);
      setPhase('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const isBusy = phase === 'compressing' || phase === 'uploading' || phase === 'verifying';
  const statusText =
    phase === 'verifying'
      ? t('scan.status.detecting')
      : phase === 'uploading'
        ? t('scan.status.uploading')
        : phase === 'compressing'
          ? t('scan.status.optimizing')
          : t('scan.status.ready');
  const ariaValueText =
    phase === 'compressing'
      ? t('scan.progress.optimizing')
      : phase === 'uploading'
        ? t('scan.progress.uploading')
        : phase === 'verifying'
          ? t('scan.progress.detecting')
          : undefined;

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
          <div className="text-xs font-semibold tracking-[0.22em] text-white/80">{t('scan.title')}</div>
          <div className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-center leading-9 text-white/70">
            ⚡
          </div>
        </div>

        <div className="mt-6 flex-1">
          <div className="relative mx-auto aspect-[3/4] w-full overflow-hidden rounded-2xl border border-emerald-200/30 bg-black/20 p-4">
            {previewUrl && (
              <img
                src={previewUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-contain"
                aria-hidden="true"
              />
            )}
            {previewUrl && <div className="absolute inset-0 bg-black/35" aria-hidden="true" />}
            <div className="absolute inset-4 rounded-xl border border-emerald-200/40" />
            <div className="absolute left-8 top-8 h-5 w-5 border-l-2 border-t-2 border-emerald-200/70" />
            <div className="absolute right-8 top-8 h-5 w-5 border-r-2 border-t-2 border-emerald-200/70" />
            <div className="absolute left-8 bottom-8 h-5 w-5 border-b-2 border-l-2 border-emerald-200/70" />
            <div className="absolute right-8 bottom-8 h-5 w-5 border-b-2 border-r-2 border-emerald-200/70" />

            <div className="absolute bottom-10 left-0 right-0 text-center">
              <div className="text-[10px] tracking-[0.22em] text-emerald-200/70">{t('scan.alignReceipt')}</div>
              <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-white/50">
                <span>{statusText}</span>
                {isBusy && <span className="tabular-nums text-white/35">{Math.round(progressValue)}%</span>}
              </div>
              {phase === 'verifying' && (
                <div className="mt-1 text-[11px] text-white/40">{t('scan.estimate')}</div>
              )}
              {isBusy && (
                <div className="mx-auto mt-3 w-[220px]">
                  <Progress.Root
                    value={progressValue}
                    aria-label={t('scan.progress.label')}
                    aria-valuetext={ariaValueText}
                    className="w-full"
                  >
                    <Progress.Track className="h-2 w-full overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
                      <Progress.Indicator className="h-full rounded-full bg-gradient-to-r from-emerald-300 via-emerald-200 to-lime-200 transition-[width] duration-200 ease-out" />
                    </Progress.Track>
                  </Progress.Root>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 text-center text-[11px] text-white/55">{t('scan.tipsTitle')}</div>
          <div className="mt-2 text-center text-xs text-white/70">{t('scan.tipsBody')}</div>
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="text-[10px] font-semibold tracking-[0.2em] text-emerald-200/70">
              {t('scan.rulesTitle')}
            </div>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-white/70">
              <li>{t('scan.rules.voter')}</li>
              <li>{t('scan.rules.upload')}</li>
              <li>{t('scan.rules.nonVoter')}</li>
            </ul>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-center">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
          />

          <button
            type="button"
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
            className="relative h-20 w-20 rounded-full border border-emerald-200/40 bg-black/30 disabled:opacity-60"
            aria-label={t('scan.captureReceipt')}
          >
            <span className="absolute inset-3 rounded-full bg-emerald-300 shadow-[0_0_0_8px_rgba(16,185,129,0.10)]" />
            {isBusy && (
              <span className="absolute inset-0 grid place-items-center">
                <span className="h-10 w-10 animate-spin rounded-full border-2 border-black/20 border-t-black/70" />
              </span>
            )}
          </button>
        </div>
      </div>
    </Screen>
  );
}
