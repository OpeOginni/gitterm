/** Compute is metered in millionths of a dollar; invoices are in cents. */
export const MICROS_PER_CENT = 10_000;

/**
 * Overage owed for a period, in whole cents: usage beyond the included
 * compute, less the plan's overage discount, rounded down. This is the
 * amount billing reports to Polar, so analytics and simulations reuse it.
 */
export function billableOverageCents(
  usageMicros: number,
  includedCents: number,
  overageDiscountPercent: number,
): number {
  const overage = Math.max(0, usageMicros / MICROS_PER_CENT - includedCents);
  return Math.floor(overage * (1 - overageDiscountPercent / 100));
}
