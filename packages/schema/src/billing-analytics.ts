import { z } from "zod";

/**
 * Read-only analytics reports and pricing simulations. Inputs are bounded
 * so no request can scan unbounded history or return unbounded rows.
 */

export const ANALYTICS_REPORTS = [
  "account_periods",
  "allowance_consumption",
  "provider_economics",
  "cohorts",
  "friction",
  "runtime_modes",
  "data_quality",
] as const;
export type AnalyticsReportName = (typeof ANALYTICS_REPORTS)[number];

export const MAX_ANALYTICS_RANGE_DAYS = 400;
export const MAX_ANALYTICS_ROWS = 5000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** A UTC date range [from, to) of at most MAX_ANALYTICS_RANGE_DAYS days. */
const dateRange = {
  from: isoDate,
  to: isoDate,
};

const refineRange = <T extends { from: string; to: string }>(value: T, ctx: z.RefinementCtx) => {
  const days = (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000;
  if (!(days > 0)) ctx.addIssue({ code: "custom", message: "`to` must be after `from`" });
  if (days > MAX_ANALYTICS_RANGE_DAYS) {
    ctx.addIssue({
      code: "custom",
      message: `Range is limited to ${MAX_ANALYTICS_RANGE_DAYS} days`,
    });
  }
};

const shortList = z.array(z.string().trim().min(1).max(64)).max(20).optional();

export const analyticsReportRequestSchema = z
  .object({
    report: z.enum(ANALYTICS_REPORTS),
    ...dateRange,
    planIds: shortList,
    planVersionIds: shortList,
    providerKeys: shortList,
    machineKeys: shortList,
    /** free | paid | legacy | admin_assigned | complimentary | trial | unknown */
    commercialCategories: shortList,
    runtimeMode: z.enum(["always_on", "on_demand"]).optional(),
    /** Signup month, YYYY-MM. */
    cohortMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    limit: z.number().int().min(1).max(MAX_ANALYTICS_ROWS).default(1000),
  })
  .superRefine(refineRange);
export type AnalyticsReportRequest = z.input<typeof analyticsReportRequestSchema>;
export type AnalyticsReportFilters = z.output<typeof analyticsReportRequestSchema>;

export type AnalyticsValue = string | number | boolean | null;

/** Machine-readable report. Every number has a definition and a denominator. */
export interface AnalyticsReport {
  report: AnalyticsReportName;
  reportVersion: number;
  generatedAt: string;
  /** Facts recorded after this instant are not included. */
  dataCutoff: string;
  filters: AnalyticsReportFilters;
  /** Units counted, e.g. account-periods or accounts. */
  sampleSize: number;
  definitions: Record<string, string>;
  warnings: string[];
  rows: Array<Record<string, AnalyticsValue>>;
  truncated: boolean;
}

export const pricingScenarioSchema = z
  .object({
    ...dateRange,
    /** Alternative terms per plan id; omitted fields keep each period's actual terms. */
    plans: z
      .record(
        z.string().min(1).max(32),
        z
          .object({
            priceCents: z.number().int().min(0).max(10_000_000).optional(),
            includedComputeCents: z.number().int().min(0).max(100_000_000).optional(),
            overageDiscountPercent: z.number().min(0).max(100).optional(),
          })
          .strict(),
      )
      .optional(),
    /** Multiply retail machine rates; the most specific matching rule wins. */
    rateMultipliers: z
      .array(
        z
          .object({
            providerKey: z.string().min(1).max(32).optional(),
            machineKey: z.string().min(1).max(64).optional(),
            multiplier: z.number().min(0).max(100),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    planIds: shortList,
  })
  .superRefine(refineRange);
export type PricingScenario = z.input<typeof pricingScenarioSchema>;

export interface PricingSimulationTotals {
  /** Subscription price plus billable overage, in cents. */
  chargesCents: number;
  overageCents: number;
  /** Account-periods whose retail usage reached the included compute. */
  periodsExhausted: number;
  /** Retail usage value, in cents. */
  retailUsageCents: number;
  /** Charges minus estimated direct cost; null when cost coverage is incomplete. */
  contributionCents: number | null;
}

export interface PricingSimulation {
  label: "Usage and customer behaviour held constant.";
  simulationVersion: number;
  generatedAt: string;
  scenario: z.output<typeof pricingScenarioSchema>;
  assumptions: string[];
  sampleSize: number;
  baseline: PricingSimulationTotals;
  simulated: PricingSimulationTotals;
  accounts: { payingMore: number; payingLess: number; unchanged: number };
  byPlan: Array<{ planId: string; periods: number; baselineCents: number; simulatedCents: number }>;
  byProvider: Array<{
    providerKey: string;
    baselineUsageCents: number;
    simulatedUsageCents: number;
  }>;
  byCohort: Array<{
    cohortMonth: string;
    periods: number;
    baselineCents: number;
    simulatedCents: number;
  }>;
  warnings: string[];
}

/** Report rows as CSV, for spreadsheet export. */
export function reportToCsv(report: AnalyticsReport): string {
  const columns = [...new Set(report.rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: AnalyticsValue) => {
    if (value === null) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    columns.join(","),
    ...report.rows.map((row) => columns.map((column) => escape(row[column] ?? null)).join(",")),
  ].join("\n");
}
