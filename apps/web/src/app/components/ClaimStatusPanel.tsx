import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

export type ClaimStatusSnapshot = {
  status: 'pending' | 'submitted' | 'confirmed' | 'failed' | string;
  tx_hash: string | null;
  failure_reason: string | null;
};

type ClaimStatusPanelProps = {
  claim: ClaimStatusSnapshot;
  className?: string;
};

export function getClaimButtonLabel(input: {
  inflight: ClaimStatusSnapshot | null;
  isClaiming: boolean;
  settledClaim: ClaimStatusSnapshot | null;
  pointsAvailable: number | null;
  claimingLabel: string;
  labels?: {
    claim: string;
    claimed: string;
    processing: string;
  };
}): string {
  const labels = input.labels ?? {
    claim: 'Claim',
    claimed: 'Claimed',
    processing: 'Processing'
  };
  if (input.inflight) return labels.processing;
  if (input.isClaiming) return input.claimingLabel;
  if (input.settledClaim?.status === 'confirmed' && (input.pointsAvailable ?? 0) <= 0) return labels.claimed;
  return labels.claim;
}

function shortHash(hash: string): string {
  const h = hash.trim();
  if (h.length <= 14) return h;
  return `${h.slice(0, 10)}...${h.slice(-4)}`;
}

function statusTitleKey(status: string): string {
  if (status === 'confirmed') return 'claim.status.confirmedTitle';
  if (status === 'failed') return 'claim.status.failedTitle';
  if (status === 'submitted') return 'claim.status.submittedTitle';
  return 'claim.status.pendingTitle';
}

function statusBadgeKey(status: string): string {
  if (status === 'confirmed') return 'claim.status.confirmedBadge';
  if (status === 'failed') return 'claim.status.failedBadge';
  if (status === 'submitted') return 'claim.status.submittedBadge';
  return 'claim.status.pendingBadge';
}

function statusMessageKey(claim: ClaimStatusSnapshot): string {
  if (claim.status === 'confirmed') return 'claim.status.confirmedMessage';
  if (claim.status === 'failed') return 'claim.status.failedMessage';
  if (claim.tx_hash) return 'claim.status.confirmingMessage';
  return 'claim.status.pendingMessage';
}

export default function ClaimStatusPanel({ claim, className }: ClaimStatusPanelProps) {
  const { t } = useTranslation();
  const isConfirmed = claim.status === 'confirmed';
  const isFailed = claim.status === 'failed';
  const message = claim.status === 'failed' && claim.failure_reason ? claim.failure_reason : t(statusMessageKey(claim));

  return (
    <div className={clsx('border border-white/10', className)}>
      <div className="text-[10px] tracking-[0.24em] text-white/40">{t('claim.status.title')}</div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{t(statusTitleKey(claim.status))}</div>
          <div className="mt-1 text-xs text-white/60">{message}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div
            className={clsx(
              'rounded-full px-3 py-1 text-[11px]',
              isConfirmed
                ? 'border border-emerald-300/30 bg-emerald-300/10 font-semibold text-emerald-200'
                : isFailed
                  ? 'border border-red-400/30 bg-red-400/10 font-semibold text-red-200'
                  : 'border border-white/10 bg-white/5 text-white/70'
            )}
          >
            {t(statusBadgeKey(claim.status))}
          </div>
          {claim.tx_hash && (
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/70">
              {shortHash(claim.tx_hash)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
