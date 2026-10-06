import { sql } from "@gitterm/db";
import {
  pricingScenarioSchema,
  type PricingScenario,
  type PricingSimulation,
  type PricingSimulationTotals,
} from "@gitterm/schema/billing-analytics";
import { billableOverageCents, MICROS_PER_CENT } from "../money";
import { readOnly } from "./reports";

/**
 * Replay closed account-periods under alternative commercial terms. Each
 * period's baseline uses its own recorded plan version and pay-as-you-go
 * setting, and both sides use billing's overage rule. Nothing is written.
 */

export const SIMULATION_VERSION = 1;
const MAX_PERIODS = 50_000;

interface PeriodUsage {
  analyticsId: string;
  periodStart: string;
  planId: string;
  cohortMonth: string | null;
  priceCents: number;
  includedCents: number | null;
  discountPercent: number;
  payAsYouGo: boolean;
  spendCapCents: number | null;
  costMicros: number | null;
  usage: Array<{ providerKey: string; machineKey: string | null; retailMicros: number }>;
}

type Multiplier = NonNullable<PricingScenario["rateMultipliers"]>[number];

/** Most specific matching rule: provider+machine, then machine, then provider. */
export function multiplierFor(
  rules: Multiplier[],
  providerKey: string,
  machineKey: string | null,
): number {
  const match =
    rules.find((rule) => rule.providerKey === providerKey && rule.machineKey === machineKey) ??
    rules.find((rule) => !rule.providerKey && rule.machineKey === machineKey) ??
    rules.find((rule) => rule.providerKey === providerKey && !rule.machineKey);
  return match?.multiplier ?? 1;
}

/** Customer charge for one period under the given terms. */
export function periodCharge(
  usageMicros: number,
  terms: { priceCents: number; includedCents: number | null; discountPercent: number },
  payAsYouGo: boolean,
): { chargeCents: number; overageCents: number; exhausted: boolean } {
  if (terms.includedCents == null) {
    return { chargeCents: terms.priceCents, overageCents: 0, exhausted: false };
  }
  const overageCents = payAsYouGo
    ? billableOverageCents(usageMicros, terms.includedCents, terms.discountPercent)
    : 0;
  return {
    chargeCents: terms.priceCents + overageCents,
    overageCents,
    exhausted: usageMicros / MICROS_PER_CENT >= terms.includedCents,
  };
}

export function runSimulation(
  periods: PeriodUsage[],
  scenario: ReturnType<typeof pricingScenarioSchema.parse>,
): Omit<PricingSimulation, "generatedAt" | "scenario" | "label" | "simulationVersion"> {
  const empty = (): PricingSimulationTotals => ({
    chargesCents: 0,
    overageCents: 0,
    periodsExhausted: 0,
    retailUsageCents: 0,
    contributionCents: 0,
  });
  const baseline = empty();
  const simulated = empty();
  const accountDelta = new Map<string, number>();
  const byPlan = new Map<
    string,
    { periods: number; baselineCents: number; simulatedCents: number }
  >();
  const byProvider = new Map<string, { baselineUsageCents: number; simulatedUsageCents: number }>();
  const byCohort = new Map<
    string,
    { periods: number; baselineCents: number; simulatedCents: number }
  >();
  let costUnknown = 0;
  let wouldPause = 0;
  let overCap = 0;
  const rules = scenario.rateMultipliers ?? [];

  for (const period of periods) {
    const baselineUsage = period.usage.reduce((sum, item) => sum + item.retailMicros, 0);
    let simulatedUsage = 0;
    for (const item of period.usage) {
      const scaled = item.retailMicros * multiplierFor(rules, item.providerKey, item.machineKey);
      simulatedUsage += scaled;
      const provider = byProvider.get(item.providerKey) ?? {
        baselineUsageCents: 0,
        simulatedUsageCents: 0,
      };
      provider.baselineUsageCents += item.retailMicros / MICROS_PER_CENT;
      provider.simulatedUsageCents += scaled / MICROS_PER_CENT;
      byProvider.set(item.providerKey, provider);
    }

    const baselineTerms = {
      priceCents: period.priceCents,
      includedCents: period.includedCents,
      discountPercent: period.discountPercent,
    };
    const override = scenario.plans?.[period.planId];
    const scenarioTerms = {
      priceCents: override?.priceCents ?? baselineTerms.priceCents,
      includedCents:
        baselineTerms.includedCents == null
          ? null
          : (override?.includedComputeCents ?? baselineTerms.includedCents),
      discountPercent: override?.overageDiscountPercent ?? baselineTerms.discountPercent,
    };
    const before = periodCharge(baselineUsage, baselineTerms, period.payAsYouGo);
    const after = periodCharge(simulatedUsage, scenarioTerms, period.payAsYouGo);

    if (!period.payAsYouGo && after.exhausted && !before.exhausted) wouldPause++;
    if (
      period.payAsYouGo &&
      period.spendCapCents != null &&
      after.overageCents > period.spendCapCents
    ) {
      overCap++;
    }

    for (const [totals, result, usage] of [
      [baseline, before, baselineUsage],
      [simulated, after, simulatedUsage],
    ] as const) {
      totals.chargesCents += result.chargeCents;
      totals.overageCents += result.overageCents;
      totals.periodsExhausted += result.exhausted ? 1 : 0;
      totals.retailUsageCents += usage / MICROS_PER_CENT;
      if (period.costMicros == null || totals.contributionCents == null)
        totals.contributionCents = null;
      else totals.contributionCents += result.chargeCents - period.costMicros / MICROS_PER_CENT;
    }
    if (period.costMicros == null) costUnknown++;

    accountDelta.set(
      period.analyticsId,
      (accountDelta.get(period.analyticsId) ?? 0) + after.chargeCents - before.chargeCents,
    );
    const plan = byPlan.get(period.planId) ?? { periods: 0, baselineCents: 0, simulatedCents: 0 };
    plan.periods++;
    plan.baselineCents += before.chargeCents;
    plan.simulatedCents += after.chargeCents;
    byPlan.set(period.planId, plan);
    const cohortKey = period.cohortMonth ?? "unknown";
    const cohort = byCohort.get(cohortKey) ?? { periods: 0, baselineCents: 0, simulatedCents: 0 };
    cohort.periods++;
    cohort.baselineCents += before.chargeCents;
    cohort.simulatedCents += after.chargeCents;
    byCohort.set(cohortKey, cohort);
  }

  const deltas = [...accountDelta.values()];
  const roundTotals = (totals: PricingSimulationTotals): PricingSimulationTotals => ({
    ...totals,
    retailUsageCents: Math.round(totals.retailUsageCents),
    contributionCents:
      totals.contributionCents == null ? null : Math.round(totals.contributionCents),
  });
  const warnings: string[] = [];
  if (costUnknown) {
    warnings.push(
      `${costUnknown} periods have usage without a provider cost rate; contribution is not computed.`,
    );
  }
  if (wouldPause) {
    warnings.push(
      `${wouldPause} periods without pay-as-you-go would have used up the scenario's included compute and been paused; their usage is still counted as if they kept running.`,
    );
  }
  if (overCap) {
    warnings.push(
      `${overCap} periods would exceed the customer's pay-as-you-go limit under the scenario.`,
    );
  }
  return {
    sampleSize: periods.length,
    assumptions: [
      "Usage and customer behaviour held constant.",
      "Each period keeps its actual plan, pay-as-you-go setting, and spend cap.",
      "Overage uses billing's rule: usage beyond the included compute, less the plan's discount, rounded down to whole cents; none without pay-as-you-go.",
      "Retail rate multipliers change customer charges only; provider costs are unchanged.",
      "Charges exclude tax and payment fees, and are computed by billing rules, not taken from invoices.",
      "Not a prediction of conversion, churn, or demand after a price change.",
    ],
    baseline: roundTotals(baseline),
    simulated: roundTotals(simulated),
    accounts: {
      payingMore: deltas.filter((delta) => delta > 0).length,
      payingLess: deltas.filter((delta) => delta < 0).length,
      unchanged: deltas.filter((delta) => delta === 0).length,
    },
    byPlan: [...byPlan].map(([planId, totals]) => ({ planId, ...totals })),
    byProvider: [...byProvider].map(([providerKey, totals]) => ({
      providerKey,
      baselineUsageCents: Math.round(totals.baselineUsageCents),
      simulatedUsageCents: Math.round(totals.simulatedUsageCents),
    })),
    byCohort: [...byCohort]
      .map(([cohortMonth, totals]) => ({ cohortMonth, ...totals }))
      .sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth)),
    warnings,
  };
}

export async function simulatePricing(input: PricingScenario): Promise<PricingSimulation> {
  const scenario = pricingScenarioSchema.parse(input);
  const from = `${scenario.from}T00:00:00.000Z`;
  const to = `${scenario.to}T00:00:00.000Z`;
  const planFilter = scenario.planIds?.length
    ? sql`and p.plan_id in (${sql.join(
        scenario.planIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;

  const periods = await readOnly(async (tx) => {
    const result = await tx.execute(sql`
      select p.analytics_id, p.period_start, p.period_end, p.plan_id, p.price_cents,
             p.included_cents, coalesce(v.overage_discount_percent, 0) as discount_percent,
             p.pay_as_you_go, p.spend_cap_cents, p.uncosted_seconds, p.cost_estimate_micros,
             to_char(s.user_created_at, 'YYYY-MM') as cohort_month,
             coalesce((
               select json_agg(json_build_object('providerKey', u.provider_key, 'machineKey', u.machine_key, 'retailMicros', u.retail_micros))
               from (
                 select i.provider_key, i.machine_key,
                   sum(greatest(0, extract(epoch from (least(coalesce(i.stopped_at, p.period_end), p.period_end) - greatest(i.started_at, p.period_start))))
                       * coalesce(i.retail_micros_per_hour, 0) / 3600) as retail_micros
                 from billing_usage_interval i
                 where i.analytics_id = p.analytics_id
                   and i.started_at < p.period_end and (i.stopped_at is null or i.stopped_at > p.period_start)
                 group by 1, 2
               ) u
             ), '[]'::json) as usage
      from billing_account_period p
      left join billing_plan_version v on v.id = p.plan_version_id
      left join billing_analytics_subject s on s.analytics_id = p.analytics_id
      where p.status = 'closed' and p.price_cents is not null
        and p.period_start >= ${from}::timestamp and p.period_start < ${to}::timestamp
        ${planFilter}
      order by p.period_start
      limit ${MAX_PERIODS}
    `);
    return result.rows as Array<Record<string, unknown>>;
  });

  const usage: PeriodUsage[] = periods.map((row) => ({
    analyticsId: row.analytics_id as string,
    periodStart: String(row.period_start),
    planId: row.plan_id as string,
    cohortMonth: (row.cohort_month as string) ?? null,
    priceCents: Number(row.price_cents),
    includedCents: row.included_cents == null ? null : Number(row.included_cents),
    discountPercent: Number(row.discount_percent),
    payAsYouGo: Boolean(row.pay_as_you_go),
    spendCapCents: row.spend_cap_cents == null ? null : Number(row.spend_cap_cents),
    costMicros: Number(row.uncosted_seconds) > 0 ? null : Number(row.cost_estimate_micros),
    usage: (row.usage as PeriodUsage["usage"]).map((item) => ({
      ...item,
      retailMicros: Number(item.retailMicros),
    })),
  }));
  const result = runSimulation(usage, scenario);
  if (periods.length >= MAX_PERIODS) {
    result.warnings.push(`Limited to ${MAX_PERIODS} periods; narrow the range.`);
  }
  if (periods.length === 0) result.warnings.push("No closed account-periods match the scenario.");
  const unpriced = periods.filter((row) => row.included_cents != null).length;
  if (unpriced < periods.length) {
    result.warnings.push(
      `${periods.length - unpriced} periods are on plans without a compute balance; only their price is compared.`,
    );
  }
  return {
    label: "Usage and customer behaviour held constant.",
    simulationVersion: SIMULATION_VERSION,
    generatedAt: new Date().toISOString(),
    scenario,
    ...result,
  };
}
