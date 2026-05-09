import { clsx } from 'clsx';

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
}): string {
  if (input.inflight) return 'PROCESSING';
  if (input.isClaiming) return input.claimingLabel;
  if (input.settledClaim?.status === 'confirmed' && (input.pointsAvailable ?? 0) <= 0) return 'CLAIMED';
  return 'CLAIM';
}

function shortHash(hash: string): string {
  const h = hash.trim();
  if (h.length <= 14) return h;
  return `${h.slice(0, 10)}...${h.slice(-4)}`;
}

function statusTitle(status: string): string {
  if (status === 'confirmed') return 'Claimed';
  if (status === 'failed') return 'Failed';
  if (status === 'submitted') return 'Submitted';
  return 'Pending';
}

function statusBadge(status: string): string {
  if (status === 'confirmed') return 'CLAIMED';
  if (status === 'failed') return 'FAILED';
  if (status === 'submitted') return 'SUBMITTED';
  return 'PENDING';
}

function statusMessage(claim: ClaimStatusSnapshot): string {
  if (claim.status === 'confirmed') return 'Claimed，B3TR 已发送到你的钱包。';
  if (claim.status === 'failed') return claim.failure_reason || 'Claim failed，请稍后重试。';
  if (claim.tx_hash) return '区块确认中，页面会自动刷新状态。';
  return '交易准备中，请稍候。';
}

export default function ClaimStatusPanel({ claim, className }: ClaimStatusPanelProps) {
  const isConfirmed = claim.status === 'confirmed';
  const isFailed = claim.status === 'failed';

  return (
    <div className={clsx('border border-white/10', className)}>
      <div className="text-[10px] tracking-[0.24em] text-white/40">CLAIM STATUS</div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{statusTitle(claim.status)}</div>
          <div className="mt-1 text-xs text-white/60">{statusMessage(claim)}</div>
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
            {statusBadge(claim.status)}
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
