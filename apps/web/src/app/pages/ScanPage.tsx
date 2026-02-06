import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Screen from '../components/Screen';
import { useAuth } from '../../state/auth';
import { apiPost } from '../../util/api';

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
  const { state } = useAuth();
  const token = state.status === 'logged_in' ? state.token : null;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'verifying' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function uploadAndVerify(file: File) {
    if (!token) throw new Error('unauthorized');

    setError(null);
    setPhase('uploading');

    const clientSubmissionId = crypto.randomUUID();
    const init = await apiPost<InitResponse>(
      '/submissions/init',
      { client_submission_id: clientSubmissionId, content_type: file.type || 'application/octet-stream' },
      token
    );

    if (init.upload) {
      const res = await fetch(init.upload.url, {
        method: init.upload.method,
        headers: init.upload.headers,
        body: file
      });
      if (!res.ok) throw new Error(`upload_failed:${res.status}`);
    }

    await apiPost(`/submissions/${init.submission.id}/complete`, {}, token);

    setPhase('verifying');
    await apiPost(`/submissions/${init.submission.id}/verify`, {}, token);

    nav(`/result/${init.submission.id}`, { replace: true });
  }

  async function onFileSelected(file: File | null) {
    if (!file) return;
    try {
      await uploadAndVerify(file);
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const isBusy = phase === 'uploading' || phase === 'verifying';

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
          <div className="text-xs font-semibold tracking-[0.22em] text-white/80">SCAN RECEIPT</div>
          <div className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-center leading-9 text-white/70">
            ⚡
          </div>
        </div>

        <div className="mt-6 flex-1">
          <div className="relative mx-auto aspect-[3/4] w-full rounded-2xl border border-emerald-200/30 bg-black/20 p-4">
            <div className="absolute inset-4 rounded-xl border border-emerald-200/40" />
            <div className="absolute left-8 top-8 h-5 w-5 border-l-2 border-t-2 border-emerald-200/70" />
            <div className="absolute right-8 top-8 h-5 w-5 border-r-2 border-t-2 border-emerald-200/70" />
            <div className="absolute left-8 bottom-8 h-5 w-5 border-b-2 border-l-2 border-emerald-200/70" />
            <div className="absolute right-8 bottom-8 h-5 w-5 border-b-2 border-r-2 border-emerald-200/70" />

            <div className="absolute bottom-10 left-0 right-0 text-center">
              <div className="text-[10px] tracking-[0.22em] text-emerald-200/70">ALIGN RECEIPT</div>
              <div className="mt-2 text-[11px] text-white/50">
                {phase === 'verifying' ? 'AI DETECTING…' : phase === 'uploading' ? 'UPLOADING…' : 'Ready'}
              </div>
            </div>
          </div>

          <div className="mt-5 text-center text-[11px] text-white/55">SCANNING TIPS</div>
          <div className="mt-2 text-center text-xs text-white/70">Keep receipt flat and visible</div>
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
            aria-label="Capture receipt"
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

