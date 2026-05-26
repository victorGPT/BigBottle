import { describe, expect, it } from 'vitest';
import {
  DAILY_SUCCESSFUL_RECEIPT_LIMIT,
  NON_VOTER_WEEKLY_SUCCESSFUL_RECEIPT_LIMIT,
  NON_VOTER_WEEKLY_TOTAL_UPLOAD_LIMIT,
  VOTER_DAILY_TOTAL_UPLOAD_LIMIT,
  getUtcDayWindow,
  getUtcWeekWindow,
  isSubmissionLimitError
} from './submission-limits.js';

describe('submission limits', () => {
  it('defines voter daily and non-voter weekly limits', () => {
    expect(DAILY_SUCCESSFUL_RECEIPT_LIMIT).toBe(1);
    expect(VOTER_DAILY_TOTAL_UPLOAD_LIMIT).toBe(2);
    expect(NON_VOTER_WEEKLY_SUCCESSFUL_RECEIPT_LIMIT).toBe(2);
    expect(NON_VOTER_WEEKLY_TOTAL_UPLOAD_LIMIT).toBe(2);
  });

  it('computes UTC calendar-day windows', () => {
    expect(getUtcDayWindow(new Date('2026-05-08T15:30:00.000Z'))).toEqual({
      startIso: '2026-05-08T00:00:00.000Z',
      endIso: '2026-05-09T00:00:00.000Z'
    });
  });

  it('computes UTC week windows starting on Monday', () => {
    expect(getUtcWeekWindow(new Date('2026-05-26T15:30:00.000Z'))).toEqual({
      startIso: '2026-05-25T00:00:00.000Z',
      endIso: '2026-06-01T00:00:00.000Z'
    });
    expect(getUtcWeekWindow(new Date('2026-05-31T23:59:59.000Z'))).toEqual({
      startIso: '2026-05-25T00:00:00.000Z',
      endIso: '2026-06-01T00:00:00.000Z'
    });
  });

  it('detects database submission limit errors from PostgREST causes', () => {
    const err = new Error('Failed to update submission', {
      cause: { code: 'P0001', message: 'weekly_upload_limit_exceeded' }
    });
    expect(isSubmissionLimitError(err)).toBe(true);
    expect(isSubmissionLimitError(err, 'weekly_upload_limit_exceeded')).toBe(true);
    expect(isSubmissionLimitError(err, 'daily_upload_limit_exceeded')).toBe(false);
  });
});
