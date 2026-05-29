export const DAILY_SUCCESSFUL_RECEIPT_LIMIT = 1;
export const VOTER_DAILY_TOTAL_UPLOAD_LIMIT = 2;
export const NON_VOTER_WEEKLY_SUCCESSFUL_RECEIPT_LIMIT = 2;
export const NON_VOTER_WEEKLY_TOTAL_UPLOAD_LIMIT = 1;

export type DayWindow = {
  startIso: string;
  endIso: string;
};

export type WeekWindow = {
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

export function getUtcWeekWindow(date = new Date()): WeekWindow {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const day = start.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function isSubmissionLimitError(err: unknown, code?: string): boolean {
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
    haystack.includes('daily_verified_limit_exceeded') ||
    haystack.includes('weekly_upload_limit_exceeded') ||
    haystack.includes('weekly_verified_limit_exceeded')
  );
}

export const isDailyLimitError = isSubmissionLimitError;
