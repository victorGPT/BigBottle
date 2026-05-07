export type PlasticImpactInput = {
  bottleCount: number;
  baselineMl?: number;
  baselinePlasticGramPerMl?: number;
  scaleFactor?: number;
};

/**
 * Plastic reduction model using a 500ml reference bottle.
 *
 * Assumption:
 * - Per-ml plastic intensity decreases as bottle count grows:
 *   u(n) = u0 / (1 + k * ln(n))
 * - Total plastic with scale effect: P(n) = u(n) * n * V
 * - Baseline (no scale effect): P0(n) = u0 * n * V
 * - Reported plastic reduction: delta = max(0, P0(n) - P(n))
 */
export function calculatePlasticReductionGrams(input: PlasticImpactInput): number {
  const baselineMl = input.baselineMl ?? 500;
  const u0 = input.baselinePlasticGramPerMl ?? 0.03;
  const k = input.scaleFactor ?? 0.2;

  const bottleCount = Number.isFinite(input.bottleCount) ? Math.max(1, Math.floor(input.bottleCount)) : 1;
  const perMl = u0 / (1 + k * Math.log(bottleCount));

  const baselineTotal = u0 * bottleCount * baselineMl;
  const scaledTotal = perMl * bottleCount * baselineMl;
  const delta = Math.max(0, baselineTotal - scaledTotal);

  return Number(delta.toFixed(3));
}
