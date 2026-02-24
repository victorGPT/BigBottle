import { describe, expect, it } from 'vitest';

import { computeClaimableB3trWei } from './rewards.js';

describe('rewards', () => {
  it('converts points to B3TR wei (18 decimals) with floor division', () => {
    expect(computeClaimableB3trWei({ pointsAvailable: 0, pointsPerB3tr: 10 })).toBe(0n);
    expect(computeClaimableB3trWei({ pointsAvailable: 1, pointsPerB3tr: 10 })).toBe(100_000_000_000_000_000n);
    expect(computeClaimableB3trWei({ pointsAvailable: 5, pointsPerB3tr: 10 })).toBe(500_000_000_000_000_000n);
    expect(computeClaimableB3trWei({ pointsAvailable: 10, pointsPerB3tr: 10 })).toBe(1_000_000_000_000_000_000n);
  });

  it('floors fractional conversions', () => {
    // floor(1e18/3)
    expect(computeClaimableB3trWei({ pointsAvailable: 1, pointsPerB3tr: 3 })).toBe(333_333_333_333_333_333n);
    // floor(2e18/3)
    expect(computeClaimableB3trWei({ pointsAvailable: 2, pointsPerB3tr: 3 })).toBe(666_666_666_666_666_666n);
  });

  it('rejects invalid inputs', () => {
    expect(() => computeClaimableB3trWei({ pointsAvailable: -1 as any, pointsPerB3tr: 10 })).toThrow();
    expect(() => computeClaimableB3trWei({ pointsAvailable: 10, pointsPerB3tr: 0 as any })).toThrow();
  });
});

