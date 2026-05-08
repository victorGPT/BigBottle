export const DAILY_SUCCESSFUL_RECEIPT_LIMIT = 3;
export const DAILY_TOTAL_UPLOAD_LIMIT = 6;

export type DayWindow = {
  startIso: string;
  endIso: string;
};

export function getUtcDayWindow(date = new Date()): DayWindow {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function isDailyLimitError(err: unknown, code?: string): boolean {
  if (!(err instanceof Error)) return false;
  const haystack = [
    err.message,
    typeof (err as any).cause === 'object' && (err as any).cause
      ? JSON.stringify((err as any).cause)
      : ''
  ].join('\n');
  if (code) return haystack.includes(code);
  return (
    haystack.includes('daily_upload_limit_exceeded') ||
    haystack.includes('daily_verified_limit_exceeded')
  );
}
