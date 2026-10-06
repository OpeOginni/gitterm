import { db, sql, type SQL } from "@gitterm/db";
import {
  analyticsReportRequestSchema,
  type AnalyticsReport,
  type AnalyticsReportFilters,
  type AnalyticsReportName,
  type AnalyticsReportRequest,
  type AnalyticsValue,
} from "@gitterm/schema/billing-analytics";
import { percentile, round } from "./stats";

/**
 * Curated, read-only reports for humans and analysis agents. Each runs in a
 * READ ONLY transaction with a statement timeout and returns definitions,
 * denominators, and data-quality warnings alongside its rows.
 */

export const REPORT_VERSION = 1;
const STATEMENT_TIMEOUT = "15s";
/** Upper bound on rows read into memory by a report. */
const MAX_SCAN_ROWS = 50_000;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = Record<string, AnalyticsValue>;

export async function readOnly<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    await tx.execute(sql.raw(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`));
    return run(tx);
  });
}

async function rows(tx: Tx, query: SQL): Promise<Array<Record<string, unknown>>> {
  return (await tx.execute(query)).rows as Array<Record<string, unknown>>;
}

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const iso = (value: unknown): string | null =>
  value == null ? null : new Date(value as string | Date).toISOString();

const at = (date: string) => sql`${`${date}T00:00:00.000Z`}::timestamp`;
const inList = (column: SQL, values: string[] | undefined) =>
  values?.length
    ? sql`${column} in (${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )})`
    : sql`true`;

/** Filters that apply to `billing_account_period p` (joined to subject `s`). */
function periodFilters(filters: AnalyticsReportFilters): SQL {
  return sql.join(
    [
      sql`p.period_start >= ${at(filters.from)} and p.period_start < ${at(filters.to)}`,
      inList(sql`p.plan_id`, filters.planIds),
      inList(sql`p.plan_version_id`, filters.planVersionIds),
      inList(sql`p.commercial_category`, filters.commercialCategories),
      filters.cohortMonth
        ? sql`to_char(s.user_created_at, 'YYYY-MM') = ${filters.cohortMonth}`
        : sql`true`,
    ],
    sql` and `,
  );
}

/** Filters that apply to `billing_usage_interval i` (joined to subject `s`). */
function intervalFilters(filters: AnalyticsReportFilters): SQL {
  return sql.join(
    [
      sql`i.started_at < ${at(filters.to)} and (i.stopped_at is null or i.stopped_at > ${at(filters.from)})`,
      inList(sql`i.provider_key`, filters.providerKeys),
      inList(sql`i.machine_key`, filters.machineKeys),
      filters.runtimeMode ? sql`i.always_on = ${filters.runtimeMode === "always_on"}` : sql`true`,
      filters.cohortMonth
        ? sql`to_char(s.user_created_at, 'YYYY-MM') = ${filters.cohortMonth}`
        : sql`true`,
    ],
    sql` and `,
  );
}

/** Seconds of interval `i` inside the report range, with running sessions counted to now. */
const intervalSeconds = (
  filters: AnalyticsReportFilters,
  cutoff: Date,
) => sql`greatest(0, extract(epoch from (
  least(coalesce(i.stopped_at, ${cutoff.toISOString()}::timestamp), ${at(filters.to)}, ${cutoff.toISOString()}::timestamp)
  - greatest(i.started_at, ${at(filters.from)})
)))`;

const costRate = sql`(
  select rate.micros_per_hour from billing_provider_cost_rate rate
  where rate.machine_profile_id = i.machine_profile_id and rate.effective_from <= i.started_at
  order by rate.effective_from desc limit 1
)`;

interface ReportBody {
  sampleSize: number;
  definitions: Record<string, string>;
  warnings: string[];
  rows: Row[];
  dataCutoff?: Date;
}

/** Latest rebuild of the period summaries; period-based reports are as of this time. */
async function summaryCutoff(tx: Tx): Promise<Date | null> {
  const [row] = await rows(
    tx,
    sql`select max(rebuilt_at) as rebuilt_at from billing_account_period`,
  );
  return row?.rebuilt_at ? new Date(row.rebuilt_at as string) : null;
}

const PERIOD_DEFINITIONS = {
  account_period:
    "One analytics account during one billing period: its Polar subscription period, else the UTC calendar month. Free accounts only have periods with usage or activity.",
  retail_usage_cents:
    "Compute consumed, valued at the retail price in effect when each session started.",
  included_cents: "Compute included by the period's actual plan version.",
  overage_billable_cents:
    "Overage owed under the period's terms using billing's own rule (discounted, rounded down); 0 when pay-as-you-go was off.",
  invoiced_net_cents:
    "Net amount (excluding tax) of Polar orders created in the period, at their latest state.",
  collected_net_cents:
    "Net amount of those orders that were paid. Refunds are reported separately, not deducted.",
  refunded_net_cents: "Amount refunded on those orders, excluding refunded tax.",
  payment_fee_cents: "Polar's fee as reported on paid orders.",
  cost_estimate_cents:
    "Estimated direct provider cost from versioned cost rates. Not invoiced cost; credits are not applied per account.",
  contribution_before_shared_cents:
    "Collected net − refunds − payment fees − estimated direct cost. Before shared and fixed costs; not profit. Null when revenue or cost data is incomplete.",
};

async function accountPeriods(tx: Tx, filters: AnalyticsReportFilters): Promise<ReportBody> {
  const result = await rows(
    tx,
    sql`select p.*, to_char(s.user_created_at, 'YYYY-MM') as cohort_month
        from billing_account_period p
        left join billing_analytics_subject s on s.analytics_id = p.analytics_id
        where ${periodFilters(filters)}
        order by p.period_start, p.analytics_id
        limit ${filters.limit + 1}`,
  );
  const warningCounts = new Map<string, number>();
  for (const row of result) {
    for (const warning of (row.warnings as string[]) ?? []) {
      warningCounts.set(warning, (warningCounts.get(warning) ?? 0) + 1);
    }
  }
  return {
    sampleSize: Math.min(result.length, filters.limit),
    definitions: {
      ...PERIOD_DEFINITIONS,
      analytics_id: "Pseudonymous account id. Not anonymous: it is personal data while linkable.",
    },
    warnings: [...warningCounts].map(([warning, count]) => `${count} periods: ${warning}`),
    rows: result.map((row) => ({
      analytics_id: row.analytics_id as string,
      cohort_month: (row.cohort_month as string) ?? null,
      period_start: iso(row.period_start),
      period_end: iso(row.period_end),
      period_source: row.period_source as string,
      status: row.status as string,
      plan_id: row.plan_id as string,
      plan_version_id: (row.plan_version_id as string) ?? null,
      commercial_category: row.commercial_category as string,
      plan_changed_mid_period: row.plan_changed_mid_period as boolean,
      pay_as_you_go: row.pay_as_you_go as boolean,
      spend_cap_cents: num(row.spend_cap_cents),
      price_cents: num(row.price_cents),
      included_cents: num(row.included_cents),
      compute_hours: round(Number(row.compute_seconds) / 3600),
      always_on_hours: round(Number(row.always_on_seconds) / 3600),
      retail_usage_cents: round(Number(row.retail_usage_micros) / 10_000),
      overage_billable_cents: num(row.overage_billable_cents),
      invoiced_net_cents: num(row.invoiced_net_cents),
      invoiced_overage_cents: num(row.invoiced_overage_cents),
      collected_net_cents: num(row.collected_net_cents),
      refunded_net_cents: num(row.refunded_net_cents),
      tax_cents: num(row.tax_cents),
      payment_fee_cents: num(row.payment_fee_cents),
      cost_estimate_cents:
        row.cost_estimate_micros == null ? null : round(Number(row.cost_estimate_micros) / 10_000),
      contribution_before_shared_cents: num(row.contribution_before_shared_cents),
      denied_attempts: num(row.denied_attempts),
      financial_pauses: num(row.financial_pauses),
      outcome: (row.outcome as string) ?? null,
      warnings: ((row.warnings as string[]) ?? []).join(";"),
    })),
  };
}

async function allowanceConsumption(tx: Tx, filters: AnalyticsReportFilters): Promise<ReportBody> {
  const periods = await rows(
    tx,
    sql`select p.plan_version_id, p.plan_id, p.status, p.included_cents, p.retail_usage_micros,
               p.pay_as_you_go, p.contribution_before_shared_cents, p.period_start,
               (select min(e.occurred_at) from billing_product_event e
                 where e.analytics_id = p.analytics_id and e.event_type = 'alert_threshold_reached'
                   and e.reason_code = 'included-100'
                   and e.occurred_at >= p.period_start and e.occurred_at < p.period_end) as exhausted_at
        from billing_account_period p
        left join billing_analytics_subject s on s.analytics_id = p.analytics_id
        where ${periodFilters(filters)} and p.included_cents is not null and p.included_cents > 0
        limit ${MAX_SCAN_ROWS}`,
  );
  const groups = new Map<string, typeof periods>();
  for (const period of periods) {
    const key = `${period.plan_id}|${period.plan_version_id}`;
    groups.set(key, [...(groups.get(key) ?? []), period]);
  }
  const result: Row[] = [];
  for (const [key, group] of groups) {
    const [planId, planVersionId] = key.split("|");
    const closed = group.filter((period) => period.status === "closed");
    const ratios = closed.map(
      (period) => Number(period.retail_usage_micros) / 10_000 / Number(period.included_cents),
    );
    const exhaustionDays = closed
      .filter((period) => period.exhausted_at)
      .map(
        (period) =>
          (new Date(period.exhausted_at as string).getTime() -
            new Date(period.period_start as string).getTime()) /
          86_400_000,
      );
    const contributions = closed.filter(
      (period) => period.contribution_before_shared_cents != null,
    );
    result.push({
      plan_id: planId!,
      plan_version_id: planVersionId === "null" ? null : planVersionId!,
      closed_periods: closed.length,
      open_periods: group.length - closed.length,
      median_consumption_ratio: round(percentile(ratios, 50), 3),
      p90_consumption_ratio: round(percentile(ratios, 90), 3),
      p95_consumption_ratio: round(percentile(ratios, 95), 3),
      exhausted_periods: ratios.filter((ratio) => ratio >= 1).length,
      exhaustion_rate: closed.length
        ? round(ratios.filter((ratio) => ratio >= 1).length / closed.length, 3)
        : null,
      zero_usage_periods: ratios.filter((ratio) => ratio === 0).length,
      median_days_to_exhaustion: round(percentile(exhaustionDays, 50), 1),
      payg_rate: closed.length
        ? round(closed.filter((period) => period.pay_as_you_go).length / closed.length, 3)
        : null,
      periods_with_contribution: contributions.length,
      negative_contribution_periods: contributions.filter(
        (period) => Number(period.contribution_before_shared_cents) < 0,
      ).length,
    });
  }
  return {
    sampleSize: periods.length,
    definitions: {
      ...PERIOD_DEFINITIONS,
      consumption_ratio:
        "Retail usage ÷ included compute, per closed account-period. Includes zero-usage periods.",
      exhaustion_rate:
        "Closed periods with consumption_ratio ≥ 1 ÷ closed periods (denominator includes inactive accounts).",
      median_days_to_exhaustion:
        "Days from period start to the 100%-of-included alert, among closed periods that reached it.",
      payg_rate: "Closed periods with pay-as-you-go on at period end ÷ closed periods.",
      negative_contribution_periods:
        "Closed periods with contribution_before_shared_cents < 0, among periods where it is known.",
    },
    warnings:
      periods.length >= MAX_SCAN_ROWS
        ? [`Scan limited to ${MAX_SCAN_ROWS} periods; narrow the filters.`]
        : [],
    rows: result.slice(0, filters.limit),
  };
}

async function providerEconomics(
  tx: Tx,
  filters: AnalyticsReportFilters,
  cutoff: Date,
): Promise<ReportBody> {
  const seconds = intervalSeconds(filters, cutoff);
  const usage = await rows(
    tx,
    sql`select i.provider_key, i.machine_key, i.machine_vcpus, i.machine_memory_gb,
               count(distinct i.analytics_id) as accounts,
               sum(${seconds}) as seconds,
               sum(case when i.retail_micros_per_hour is null then ${seconds} else 0 end) as unpriced_seconds,
               sum(${seconds} * coalesce(i.retail_micros_per_hour, 0) / 3600) as retail_micros,
               sum(case when cost.rate is null then ${seconds} else 0 end) as uncosted_seconds,
               sum(${seconds} * coalesce(cost.rate, 0) / 3600) as cost_micros
        from billing_usage_interval i
        left join billing_analytics_subject s on s.analytics_id = i.analytics_id
        left join lateral (select ${costRate} as rate) cost on true
        where ${intervalFilters(filters)}
        group by 1, 2, 3, 4
        order by retail_micros desc
        limit ${filters.limit}`,
  );
  const invoices = await rows(
    tx,
    sql`select provider_key, scope, status, currency,
               count(*) as records,
               sum(estimated_micros) as estimated_micros, count(estimated_micros) as estimated_known,
               sum(invoiced_micros) as invoiced_micros, count(invoiced_micros) as invoiced_known,
               sum(credits_micros) as credits_micros, count(credits_micros) as credits_known,
               sum(cash_micros) as cash_micros, count(cash_micros) as cash_known
        from billing_provider_cost
        where period_start < ${at(filters.to)} and period_end > ${at(filters.from)}
          and ${inList(sql`provider_key`, filters.providerKeys)}
        group by 1, 2, 3, 4
        order by 1, 2, 3`,
  );
  const result: Row[] = usage.map((row) => {
    const total = Number(row.seconds);
    const priced = total - Number(row.unpriced_seconds);
    const costed = total - Number(row.uncosted_seconds);
    const retail = Number(row.retail_micros) / 10_000;
    const cost = Number(row.cost_micros) / 10_000;
    return {
      section: "usage",
      provider_key: row.provider_key as string,
      machine_key: (row.machine_key as string) ?? null,
      machine_vcpus: num(row.machine_vcpus),
      machine_memory_gb: num(row.machine_memory_gb),
      accounts: num(row.accounts),
      compute_hours: round(total / 3600),
      priced_share: total ? round(priced / total, 3) : null,
      retail_usage_cents: round(retail),
      costed_share: total ? round(costed / total, 3) : null,
      cost_estimate_cents: costed === total ? round(cost) : null,
      estimated_gross_margin:
        priced === total && costed === total && retail > 0
          ? round((retail - cost) / retail, 3)
          : null,
    };
  });
  for (const row of invoices) {
    const amount = (sum: unknown, known: unknown) =>
      Number(known) === Number(row.records) ? round(Number(sum) / 10_000) : null;
    result.push({
      section: "provider_costs",
      provider_key: row.provider_key as string,
      scope: row.scope as string,
      status: row.status as string,
      currency: row.currency as string,
      records: num(row.records),
      estimated_cents: amount(row.estimated_micros, row.estimated_known),
      invoiced_cents: amount(row.invoiced_micros, row.invoiced_known),
      credits_cents: amount(row.credits_micros, row.credits_known),
      cash_cents: amount(row.cash_micros, row.cash_known),
    });
  }
  return {
    sampleSize: usage.length,
    dataCutoff: cutoff,
    definitions: {
      compute_hours:
        "Hours of usage sessions inside the range; running sessions count to the cutoff.",
      priced_share:
        "Share of hours on sizes with a retail price. Unpriced usage is not zero-priced.",
      retail_usage_cents: "Retail value of the priced hours.",
      cost_estimate_cents:
        "Estimated provider cost from versioned cost rates; null unless every hour has a cost rate.",
      estimated_gross_margin: "(retail − estimated cost) ÷ retail, only when both are fully known.",
      provider_costs:
        "Imported provider records overlapping the range. Shared costs are platform overhead, kept apart from direct compute. A total is null if any record lacks that amount.",
    },
    warnings: usage.some((row) => Number(row.uncosted_seconds) > 0)
      ? ["Some usage has no provider cost rate; its cost is unknown, not zero."]
      : [],
    rows: result,
  };
}

async function cohorts(tx: Tx, filters: AnalyticsReportFilters, cutoff: Date): Promise<ReportBody> {
  const result = await rows(
    tx,
    sql`with signups as (
          select s.analytics_id, s.user_created_at, to_char(s.user_created_at, 'YYYY-MM') as cohort_month
          from billing_analytics_subject s
          where s.user_created_at >= ${at(filters.from)} and s.user_created_at < ${at(filters.to)}
            and ${filters.cohortMonth ? sql`to_char(s.user_created_at, 'YYYY-MM') = ${filters.cohortMonth}` : sql`true`}
        )
        select c.cohort_month,
          count(*) as signups,
          count(*) filter (where exists (
            select 1 from billing_usage_interval i where i.analytics_id = c.analytics_id
              and i.started_at < c.user_created_at + interval '30 days')) as active_first_30_days,
          count(*) filter (where c.user_created_at <= ${cutoff.toISOString()}::timestamp - interval '30 days') as eligible_30_days,
          count(*) filter (where exists (
            select 1 from billing_account_event e where e.analytics_id = c.analytics_id
              and e.commercial_category in ('paid', 'legacy'))) as ever_paid,
          count(*) filter (where (
            select e.commercial_category from billing_account_event e where e.analytics_id = c.analytics_id
            order by e.effective_at desc limit 1) in ('paid', 'legacy')) as paying_now
        from signups c
        group by 1 order by 1
        limit ${filters.limit}`,
  );
  return {
    sampleSize: result.reduce((sum, row) => sum + Number(row.signups), 0),
    dataCutoff: cutoff,
    definitions: {
      signups: "Users who signed up in the month (deleted users are no longer counted).",
      active_first_30_days: "Signups with any usage session starting within 30 days of signup.",
      eligible_30_days:
        "Signups at least 30 days old at the cutoff: the fair denominator for active_first_30_days.",
      ever_paid:
        "Signups with any Polar-paid (or legacy) plan event. Admin-assigned plans are excluded.",
      paying_now: "Signups whose latest commercial event is a Polar-paid or legacy plan.",
    },
    warnings: [
      "Commercial events are only known from when tracking began; earlier upgrades are not counted.",
    ],
    rows: result.map((row) => ({
      cohort_month: row.cohort_month as string,
      signups: num(row.signups),
      active_first_30_days: num(row.active_first_30_days),
      eligible_30_days: num(row.eligible_30_days),
      ever_paid: num(row.ever_paid),
      paying_now: num(row.paying_now),
    })),
  };
}

async function friction(
  tx: Tx,
  filters: AnalyticsReportFilters,
  cutoff: Date,
): Promise<ReportBody> {
  const range = sql`e.occurred_at >= ${at(filters.from)} and e.occurred_at < ${at(filters.to)}`;
  const blocks = await rows(
    tx,
    sql`select e.event_type, e.reason_code,
               count(*) as events, count(distinct e.analytics_id) as accounts,
               count(distinct e.analytics_id) filter (where exists (
                 select 1 from billing_account_event a where a.analytics_id = e.analytics_id
                   and a.event_type = 'payg_changed' and a.effective_at between e.occurred_at and e.occurred_at + interval '7 days'
                   and (a.pay_as_you_go and (not coalesce(a.previous_pay_as_you_go, false)
                        or coalesce(a.spend_cap_cents, 0) > coalesce(a.previous_spend_cap_cents, 0))))) as accounts_raised_payg_7d,
               count(distinct e.analytics_id) filter (where exists (
                 select 1 from billing_account_event a
                 join billing_plan_version v on v.id = a.plan_version_id
                 left join billing_plan_version pv on pv.id = e.plan_version_id
                 where a.analytics_id = e.analytics_id and a.event_type = 'plan_changed'
                   and a.effective_at between e.occurred_at and e.occurred_at + interval '7 days'
                   and v.price_cents > coalesce(pv.price_cents, 0))) as accounts_upgraded_7d
        from billing_product_event e
        left join billing_analytics_subject s on s.analytics_id = e.analytics_id
        where ${range} and e.event_type in ('run_denied', 'workspace_paused_for_spending', 'alert_threshold_reached')
          and ${filters.cohortMonth ? sql`to_char(s.user_created_at, 'YYYY-MM') = ${filters.cohortMonth}` : sql`true`}
        group by 1, 2 order by 1, 2`,
  );
  const deliveries = await rows(
    tx,
    sql`select e.outcome, count(*) as events from billing_product_event e
        where ${range} and e.event_type = 'alert_delivery' group by 1`,
  );
  const reliability = await rows(
    tx,
    sql`select e.event_type, e.provider_key, e.outcome, e.latency_ms from billing_product_event e
        where ${range} and e.event_type in ('provision_result', 'resume_result')
          and ${inList(sql`e.provider_key`, filters.providerKeys)}
        limit ${MAX_SCAN_ROWS}`,
  );
  const result: Row[] = blocks.map((row) => ({
    section: "spending_friction",
    event_type: row.event_type as string,
    reason_code: (row.reason_code as string) ?? null,
    events: num(row.events),
    accounts: num(row.accounts),
    accounts_raised_payg_7d: num(row.accounts_raised_payg_7d),
    accounts_upgraded_7d: num(row.accounts_upgraded_7d),
  }));
  for (const row of deliveries) {
    result.push({
      section: "alert_delivery",
      outcome: (row.outcome as string) ?? null,
      events: num(row.events),
    });
  }
  const groups = new Map<string, typeof reliability>();
  for (const row of reliability) {
    const key = `${row.event_type}|${row.provider_key}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const [key, group] of groups) {
    const [eventType, providerKey] = key.split("|");
    const latencies = group
      .filter((row) => row.outcome === "success")
      .map((row) => Number(row.latency_ms));
    result.push({
      section: "reliability",
      event_type: eventType!,
      provider_key: providerKey!,
      attempts: group.length,
      failures: group.filter((row) => row.outcome === "failure").length,
      success_rate: round(
        group.filter((row) => row.outcome === "success").length / group.length,
        3,
      ),
      p50_latency_ms: round(percentile(latencies, 50), 0),
      p90_latency_ms: round(percentile(latencies, 90), 0),
      p95_latency_ms: round(percentile(latencies, 95), 0),
    });
  }
  return {
    sampleSize: blocks.reduce((sum, row) => sum + Number(row.events), 0) + reliability.length,
    dataCutoff: cutoff,
    definitions: {
      run_denied:
        "A customer create/resume/restart attempt refused by spending policy. One per attempt.",
      workspace_paused_for_spending:
        "A running workspace the worker paused for balance or spend cap. One per pause.",
      reason_code:
        "*_exhausted / *_reached: usage used it up. *_reserved: not yet used up, but within the reserved running minutes.",
      accounts_raised_payg_7d:
        "Accounts that turned on pay-as-you-go or raised their cap within 7 days after the event.",
      accounts_upgraded_7d:
        "Accounts that moved to a higher-priced plan within 7 days after the event.",
      alert_delivery:
        "Email delivery attempts. A threshold being reached is not proof the customer saw it.",
      reliability:
        "API request outcome and latency for provisioning and resume (request duration, not time until the workspace is ready).",
    },
    warnings: [
      "Product events are best-effort and kept for a limited retention window.",
      ...(reliability.length >= MAX_SCAN_ROWS
        ? [`Reliability scan limited to ${MAX_SCAN_ROWS} events.`]
        : []),
    ],
    rows: result.slice(0, filters.limit),
  };
}

async function runtimeModes(
  tx: Tx,
  filters: AnalyticsReportFilters,
  cutoff: Date,
): Promise<ReportBody> {
  const seconds = intervalSeconds(filters, cutoff);
  const result = await rows(
    tx,
    sql`select i.always_on, i.workload,
               count(*) as sessions, count(distinct i.analytics_id) as accounts,
               sum(${seconds}) as seconds,
               sum(${seconds} * coalesce(i.retail_micros_per_hour, 0) / 3600) as retail_micros,
               sum(case when i.retail_micros_per_hour is null then ${seconds} else 0 end) as unpriced_seconds,
               sum(${seconds} * coalesce(cost.rate, 0) / 3600) as cost_micros,
               sum(case when cost.rate is null then ${seconds} else 0 end) as uncosted_seconds
        from billing_usage_interval i
        left join billing_analytics_subject s on s.analytics_id = i.analytics_id
        left join lateral (select ${costRate} as rate) cost on true
        where ${intervalFilters(filters)}
        group by 1, 2 order by 1, 2`,
  );
  const total = result.reduce((sum, row) => sum + Number(row.seconds), 0);
  return {
    sampleSize: result.reduce((sum, row) => sum + Number(row.sessions), 0),
    dataCutoff: cutoff,
    definitions: {
      runtime_mode:
        "always_on when the workspace was always-on at session capture; otherwise on_demand.",
      workload:
        "bot when a chat bot created the workspace; user otherwise. Not a measure of idleness.",
      share_of_hours: "This group's hours ÷ all hours matching the filters.",
    },
    warnings: [
      "Always-on is captured per session; toggling it mid-session is not reflected.",
      "No agent-run activity is not evidence of idle or wasted compute: interactive and background work also run in sandboxes.",
    ],
    rows: result.map((row) => ({
      runtime_mode: row.always_on ? "always_on" : "on_demand",
      workload: row.workload as string,
      sessions: num(row.sessions),
      accounts: num(row.accounts),
      compute_hours: round(Number(row.seconds) / 3600),
      share_of_hours: total ? round(Number(row.seconds) / total, 3) : null,
      retail_usage_cents: round(Number(row.retail_micros) / 10_000),
      unpriced_hours: round(Number(row.unpriced_seconds) / 3600),
      cost_estimate_cents:
        Number(row.uncosted_seconds) === 0 ? round(Number(row.cost_micros) / 10_000) : null,
    })),
  };
}

async function dataQuality(
  tx: Tx,
  filters: AnalyticsReportFilters,
  cutoff: Date,
): Promise<ReportBody> {
  const seconds = intervalSeconds(filters, cutoff);
  const [usage] = await rows(
    tx,
    sql`select count(*) as intervals, sum(${seconds}) as seconds,
               sum(case when i.retail_micros_per_hour is null then ${seconds} else 0 end) as unpriced_seconds,
               sum(case when cost.rate is null then ${seconds} else 0 end) as uncosted_seconds,
               count(*) filter (where i.machine_provenance <> 'observed') as inferred_machine_specs,
               count(*) filter (where i.status = 'open') as open_intervals
        from billing_usage_interval i
        left join billing_analytics_subject s on s.analytics_id = i.analytics_id
        left join lateral (select ${costRate} as rate) cost on true
        where ${intervalFilters(filters)}`,
  );
  const [payments] = await rows(
    tx,
    sql`select count(distinct provider_object_id) filter (where kind = 'order') as orders,
               count(distinct provider_object_id) filter (where kind = 'order' and analytics_id is null) as orders_unlinked,
               count(distinct provider_object_id) filter (where kind = 'order' and overage_cents is null) as orders_unclassified,
               count(distinct provider_object_id) filter (where kind = 'order' and platform_fee_cents is null) as orders_fee_unknown,
               count(distinct provider_object_id) filter (where kind = 'refund' and is_dispute) as disputes
        from billing_payment_event
        where object_created_at >= ${at(filters.from)} and object_created_at < ${at(filters.to)}`,
  );
  const periodWarnings = await rows(
    tx,
    sql`select warning, count(*) as periods from billing_account_period p
        left join billing_analytics_subject s on s.analytics_id = p.analytics_id,
        unnest(p.warnings) as warning
        where ${periodFilters(filters)} group by 1 order by 2 desc`,
  );
  const provenance = await rows(
    tx,
    sql`select provenance, count(*) as events from billing_account_event
        where effective_at < ${at(filters.to)} group by 1`,
  );
  const costs = await rows(
    tx,
    sql`select status, count(*) as records from billing_provider_cost
        where period_start < ${at(filters.to)} and period_end > ${at(filters.from)} group by 1`,
  );
  const [watermark] = await rows(
    tx,
    sql`select watermark from billing_job_state where name = 'analytics'`,
  );
  const total = Number(usage?.seconds ?? 0);
  const result: Row[] = [
    {
      section: "usage",
      intervals: num(usage?.intervals),
      open_intervals: num(usage?.open_intervals),
      priced_share: total ? round(1 - Number(usage!.unpriced_seconds) / total, 3) : null,
      costed_share: total ? round(1 - Number(usage!.uncosted_seconds) / total, 3) : null,
      inferred_machine_specs: num(usage?.inferred_machine_specs),
    },
    {
      section: "payments",
      orders: num(payments?.orders),
      orders_unlinked_to_account: num(payments?.orders_unlinked),
      orders_without_overage_split: num(payments?.orders_unclassified),
      orders_fee_unknown: num(payments?.orders_fee_unknown),
      disputes: num(payments?.disputes),
    },
    ...periodWarnings.map((row) => ({
      section: "period_warnings",
      warning: row.warning as string,
      periods: num(row.periods),
    })),
    ...provenance.map((row) => ({
      section: "account_event_provenance",
      provenance: row.provenance as string,
      events: num(row.events),
    })),
    ...costs.map((row) => ({
      section: "provider_cost_status",
      status: row.status as string,
      records: num(row.records),
    })),
    { section: "jobs", analytics_watermark: iso(watermark?.watermark) },
  ];
  return {
    sampleSize: Number(usage?.intervals ?? 0),
    dataCutoff: cutoff,
    definitions: {
      priced_share: "Share of usage hours with a retail price.",
      costed_share: "Share of usage hours with a provider cost-rate estimate.",
      inferred_machine_specs:
        "Intervals whose machine spec was backfilled from the current profile, not observed.",
      orders_without_overage_split:
        "Orders whose overage portion is unknown (set POLAR_OVERAGE_PRICE_IDS to classify metered items).",
      account_event_provenance:
        "observed: recorded when it happened. reconstructed/inferred: derived later by a backfill.",
    },
    warnings: [],
    rows: result,
  };
}

const REPORTS: Record<
  AnalyticsReportName,
  (tx: Tx, filters: AnalyticsReportFilters, cutoff: Date) => Promise<ReportBody>
> = {
  account_periods: accountPeriods,
  allowance_consumption: allowanceConsumption,
  provider_economics: providerEconomics,
  cohorts,
  friction,
  runtime_modes: runtimeModes,
  data_quality: dataQuality,
};

const PERIOD_REPORTS = new Set<AnalyticsReportName>(["account_periods", "allowance_consumption"]);

export async function getReport(request: AnalyticsReportRequest): Promise<AnalyticsReport> {
  const filters = analyticsReportRequestSchema.parse(request);
  const now = new Date();
  return readOnly(async (tx) => {
    const body = await REPORTS[filters.report](tx, filters, now);
    const cutoff = PERIOD_REPORTS.has(filters.report)
      ? await summaryCutoff(tx)
      : (body.dataCutoff ?? now);
    const truncated = body.rows.length > filters.limit;
    return {
      report: filters.report,
      reportVersion: REPORT_VERSION,
      generatedAt: now.toISOString(),
      dataCutoff: (cutoff ?? now).toISOString(),
      filters,
      sampleSize: body.sampleSize,
      definitions: body.definitions,
      warnings: [
        ...body.warnings,
        ...(PERIOD_REPORTS.has(filters.report) && !cutoff
          ? ["Period summaries have not been built yet."]
          : []),
      ],
      rows: body.rows.slice(0, filters.limit),
      truncated,
    };
  });
}
