import { describe, expect, it } from 'vitest';

import { getPostgresErrorCode, isUniqueViolation } from './postgres-errors.js';

describe('postgres-errors', () => {
  it('extracts error code from Error.cause', () => {
    const err = new Error('boom', { cause: { code: '23505' } });
    expect(getPostgresErrorCode(err)).toBe('23505');
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('returns null when no code is present', () => {
    expect(getPostgresErrorCode(new Error('boom'))).toBe(null);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
  });
});

