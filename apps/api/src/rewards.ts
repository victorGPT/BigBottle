import { formatUnits } from 'ethers';

const B3TR_DECIMALS = 18n;

export function computeClaimableB3trWei(input: { pointsAvailable: number; pointsPerB3tr: number }): bigint {
  const { pointsAvailable, pointsPerB3tr } = input;

  if (!Number.isInteger(pointsAvailable) || pointsAvailable < 0) {
    throw new Error('points_available_invalid');
  }
  if (!Number.isInteger(pointsPerB3tr) || pointsPerB3tr <= 0) {
    throw new Error('points_per_b3tr_invalid');
  }

  if (pointsAvailable === 0) return 0n;

  return (BigInt(pointsAvailable) * 10n ** B3TR_DECIMALS) / BigInt(pointsPerB3tr);
}

export function formatB3trDisplay(amountWei: bigint): string {
  if (amountWei < 0n) throw new Error('amount_invalid');
  return formatUnits(amountWei, 18);
}

