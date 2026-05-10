export type Translate = (key: string, options?: Record<string, unknown>) => string;

export function formatMultiplierNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatMultiplierValue(value: number, t: Translate): string {
  return t('common.multiplierValue', { multiplier: formatMultiplierNumber(value) });
}

export function normalizeGmNftLevel(value: unknown): number | null {
  const level = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(level) && level >= 0 ? level : null;
}

export function getGmNftLevelName(level: number | null, t: Translate): string {
  if (level === null) return t('account.achievement.gmNftTitle');
  if (level >= 0 && level <= 10) return t(`gmNft.level.${level}`);
  return t('gmNft.level.generic', { level });
}

export function getSubmissionStatusLabel(status: string, t: Translate): string {
  if (status === 'pending_upload') return t('submission.status.pendingUpload');
  if (status === 'uploaded') return t('submission.status.uploaded');
  if (status === 'verifying') return t('submission.status.verifying');
  if (status === 'verified') return t('submission.status.verified');
  if (status === 'rejected') return t('submission.status.rejected');
  if (status === 'not_claimable') return t('submission.status.notClaimable');
  return t('submission.status.unknown');
}
