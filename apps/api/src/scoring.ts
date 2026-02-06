export type DifyDrinkItem = {
  retinfoDrinkName?: unknown;
  retinfoDrinkCapacity?: unknown;
  retinfoDrinkAmount?: unknown;
};

const MAX_ITEMS = 25;
const MAX_AMOUNT = 20;
const MAX_TOTAL_POINTS = 500;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function parseCapacityMl(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) {
    const v = Math.floor(input);
    return v > 0 ? v : null;
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

export function parseAmount(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    const v = Math.floor(input);
    return clampInt(v, 1, MAX_AMOUNT);
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return 1;
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n)) return 1;
    return clampInt(n, 1, MAX_AMOUNT);
  }
  return 1;
}

export function pointsForCapacityMl(capacityMl: number | null): number {
  if (capacityMl === null) return 0;
  if (capacityMl < 500) return 0;
  if (capacityMl < 1000) return 2;
  if (capacityMl < 2000) return 10;
  return 15;
}

export function computeTotalPoints(drinkList: unknown): {
  totalPoints: number;
  items: Array<{
    capacityMl: number | null;
    amount: number;
    tierPoints: number;
    points: number;
  }>;
} {
  const list = Array.isArray(drinkList) ? (drinkList as DifyDrinkItem[]).slice(0, MAX_ITEMS) : [];
  const items = list.map((item) => {
    const capacityMl = parseCapacityMl(item.retinfoDrinkCapacity);
    const amount = parseAmount(item.retinfoDrinkAmount);
    const tierPoints = pointsForCapacityMl(capacityMl);
    const points = tierPoints * amount;
    return { capacityMl, amount, tierPoints, points };
  });
  const uncappedTotalPoints = items.reduce((sum, i) => sum + i.points, 0);
  const totalPoints = Math.min(uncappedTotalPoints, MAX_TOTAL_POINTS);
  return { totalPoints, items };
}
