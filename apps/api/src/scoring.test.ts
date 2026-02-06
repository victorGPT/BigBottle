import { describe, expect, it } from 'vitest';
import {
  computeTotalPoints,
  parseAmount,
  parseCapacityMl,
  pointsForCapacityMl
} from './scoring.js';

describe('scoring', () => {
  it('parses capacity ml robustly', () => {
    expect(parseCapacityMl(500)).toBe(500);
    expect(parseCapacityMl(500.9)).toBe(500);
    expect(parseCapacityMl('1000')).toBe(1000);
    expect(parseCapacityMl(' 2000 ')).toBe(2000);
    expect(parseCapacityMl('')).toBeNull();
    expect(parseCapacityMl('nope')).toBeNull();
    expect(parseCapacityMl(null)).toBeNull();
    expect(parseCapacityMl(-1)).toBeNull();
  });

  it('parses amount with default=1', () => {
    expect(parseAmount(undefined)).toBe(1);
    expect(parseAmount(null)).toBe(1);
    expect(parseAmount(0)).toBe(1);
    expect(parseAmount(-10)).toBe(1);
    expect(parseAmount(1)).toBe(1);
    expect(parseAmount(2.9)).toBe(2);
    expect(parseAmount('3')).toBe(3);
    expect(parseAmount(999)).toBe(20);
    expect(parseAmount('999')).toBe(20);
  });

  it('computes tier points by capacity boundaries', () => {
    expect(pointsForCapacityMl(null)).toBe(0);
    expect(pointsForCapacityMl(0)).toBe(0);
    expect(pointsForCapacityMl(499)).toBe(0);
    expect(pointsForCapacityMl(500)).toBe(2);
    expect(pointsForCapacityMl(999)).toBe(2);
    expect(pointsForCapacityMl(1000)).toBe(10);
    expect(pointsForCapacityMl(1999)).toBe(10);
    expect(pointsForCapacityMl(2000)).toBe(15);
    expect(pointsForCapacityMl(9999)).toBe(15);
  });

  it('sums points across drinkList', () => {
    const res = computeTotalPoints([
      { retinfoDrinkCapacity: 500, retinfoDrinkAmount: 1 },
      { retinfoDrinkCapacity: '1000', retinfoDrinkAmount: '2' },
      { retinfoDrinkCapacity: null, retinfoDrinkAmount: 100 }
    ]);

    // 500 => 2 * 1
    // 1000 => 10 * 2
    // null => 0
    expect(res.totalPoints).toBe(22);
  });

  it('caps total points to avoid runaway scoring', () => {
    const res = computeTotalPoints([
      { retinfoDrinkCapacity: 2000, retinfoDrinkAmount: 999 }, // amount is clamped
      { retinfoDrinkCapacity: 2000, retinfoDrinkAmount: 999 }
    ]);
    // Each item: 15 * 20 = 300, total would be 600 but capped.
    expect(res.totalPoints).toBe(500);
  });

  it('limits max processed drinkList length', () => {
    const list = Array.from({ length: 100 }, () => ({
      retinfoDrinkCapacity: 2000,
      retinfoDrinkAmount: 1
    }));
    const res = computeTotalPoints(list);
    expect(res.items.length).toBe(25);
  });
});
