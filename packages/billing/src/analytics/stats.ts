/** Linear-interpolated percentile of `values` (0-100); null for an empty sample. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = ((sorted.length - 1) * p) / 100;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

export const round = (value: number | null, digits = 2) =>
  value === null ? null : Number(value.toFixed(digits));
