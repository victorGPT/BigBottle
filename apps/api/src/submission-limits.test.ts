import { describe, expect, it } from 'vitest';
import { DAILY_SUCCESSFUL_RECEIPT_LIMIT, getUtcDayWindow, isDailyLimitError } from './submission-limits.js';

describe('submission limits', () => {
  it('allows only one successful receipt per UTC day', () => {
    expect(DAILY_SUCCESSFUL_RECEIPT_LIMIT).toBe(1);
  });

  it('computes UTC calendar-day windows', () => {
    expect(getUtcDayWindow(new Date('2026-05-08T15:30:00.000Z'))).toEqual({
      startIso: '2026-05-08T00:00:00.000Z',
      endIso: '2026-05-09T00:00:00.000Z'
    });
  });

  it('detects database daily limit errors from PostgREST causes', () => {
    const err = new Error('Failed to update submission', {
      cause: { code: 'P0001', message: 'daily_verified_limit_exceeded' }
    });
    expect(isDailyLimitError(err)).toBe(true);
    expect(isDailyLimitError(err, 'daily_verified_limit_exceeded')).toBe(true);
    expect(isDailyLimitError(err, 'daily_upload_limit_exceeded')).toBe(false);
  });
});
