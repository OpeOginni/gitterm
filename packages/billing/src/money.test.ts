import { describe, expect, test } from "bun:test";
import { billableOverageCents } from "./money";
import { percentile } from "./analytics/stats";

describe("billableOverageCents", () => {
  test("bills nothing within the included compute", () => {
    expect(billableOverageCents(9_000_000, 1000, 0)).toBe(0);
  });

  test("discounts and rounds overage down to whole cents", () => {
    // $100.0099 used against $100 included: 0.99 cents over, 20% off -> 0.
    expect(billableOverageCents(100_009_900, 10000, 20)).toBe(0);
    // $120 used against $100 included: $20 over, 20% off -> $16.
    expect(billableOverageCents(120_000_000, 10000, 20)).toBe(1600);
  });
});

describe("percentile", () => {
  test("interpolates and handles empty samples", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10], 95)).toBe(10);
  });
});
