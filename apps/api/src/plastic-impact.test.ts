import { describe, expect, it } from 'vitest';

import { calculatePlasticReductionGrams } from './plastic-impact.js';

describe('plastic impact', () => {
  it('returns non-negative grams and grows with bottle count', () => {
    expect(calculatePlasticReductionGrams({ bottleCount: 1 })).toBe(0);
    expect(calculatePlasticReductionGrams({ bottleCount: 2 })).toBeGreaterThan(0);
    expect(calculatePlasticReductionGrams({ bottleCount: 10 })).toBeGreaterThan(
      calculatePlasticReductionGrams({ bottleCount: 2 })
    );
  });

  it('normalizes invalid bottle counts to the 500ml baseline bottle', () => {
    expect(calculatePlasticReductionGrams({ bottleCount: 0 })).toBe(0);
    expect(calculatePlasticReductionGrams({ bottleCount: Number.NaN })).toBe(0);
  });
});
