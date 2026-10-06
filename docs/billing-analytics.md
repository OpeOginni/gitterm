# Billing analytics

Historical evidence for pricing, allowance, provider and customer-experience decisions on managed GitTerm. Humans and read-only analysis agents use it to inspect what happened and to simulate alternatives. **It never changes prices, plans, balances or invoices.**

Everything here lives in `@gitterm/billing` and runs only when `DEPLOYMENT_MODE=managed`. Self-hosted deployments use `unlimitedBilling`: they create no analytics rows, run no analytics jobs, and send no telemetry.

## Data flow and ownership

```
usage_session ──(worker pass, watermark)──▶ billing_usage_interval ─┐
Polar webhooks / admin / settings ──(same transaction)──▶ billing_account_event ─┤
Polar order + refund webhooks / API backfill ──▶ billing_payment_event ─┼─▶ billing_account_period (rebuilt)
core observations (denials, pauses, alerts, provisioning) ──▶ billing_product_event ─┘
provider invoices / cost rates (CLI import) ──▶ billing_provider_cost, billing_provider_cost_rate
```

- **Billing owns** commercial history, payments, retail rates, cost estimates and the summaries.
- **Core owns** runtime observations. It reports them through `Billing.recordObservation` (provisioning/resume outcome and latency, financial pauses, alert delivery) and passes the customer's attempt to `checkRunAllowance` so denials are recorded.
- **Stable identifier:** `analytics_id` from `billing_analytics_subject`, one per user.

## Tables and grain

| Table                        | Grain                                        | Notes                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billing_analytics_subject`  | one per user                                 | The only `user_id ↔ analytics_id` link. Deleted with the user. Holds signup time for cohorts.                                                                                                                                                                                                                                             |
| `billing_plan_version`       | one per distinct set of terms                | `id = <plan>-<sha256(terms)[:12]>`: price, included compute, overage discount, daily minutes, entitlements, `terms_schema_version`. Immutable, so old periods stay interpretable after `plans.ts` changes.                                                                                                                                |
| `billing_account_event`      | one per commercial change                    | Event types: `plan_changed`, `period_started`, `payg_changed`, `cancellation_requested`, `cancellation_withdrawn`, `access_revoked`, `account_snapshot`. Carries previous and new values, plan version, source, actor, commercial category, provenance and an idempotency key. Written in the **same transaction** as the account change. |
| `billing_usage_interval`     | one per usage session                        | Snapshots provider, region, machine spec, always-on, bot vs user workload, and the retail rate in effect at session start. No foreign keys, so it survives workspace and user deletion. Open until the session stops.                                                                                                                     |
| `billing_provider_cost_rate` | one per estimate rate version                | Estimated provider cost per hour of a machine size. Effective-dated, separate from retail rates.                                                                                                                                                                                                                                          |
| `billing_provider_cost`      | one per provider record                      | Invoices and usage exports, direct or shared. Estimated, invoiced, credits and cash amounts are kept separately. Upserted by `(provider_key, source_record_id)`.                                                                                                                                                                          |
| `billing_payment_event`      | one per observed state of an order or refund | Append-only. Replays are ignored by idempotency key; the latest `occurred_at` wins, so out-of-order delivery is safe, and earlier states remain as an audit trail.                                                                                                                                                                        |
| `billing_product_event`      | one per attempt or state change              | `run_denied` (per attempt), `workspace_paused_for_spending` (per pause), `alert_threshold_reached` (once per threshold per period), `alert_delivery` (per notice), `provision_result` and `resume_result` (per request). Best-effort, and purged after a retention window.                                                                |
| `billing_account_period`     | one per account × billing period             | Rebuildable summary; never edited by hand.                                                                                                                                                                                                                                                                                                |
| `billing_job_state`          | one per job                                  | Watermark for incremental work.                                                                                                                                                                                                                                                                                                           |

### Commercial categories

`paid` (Polar subscription), `legacy` (Starter), `trial`, `admin_assigned`, `complimentary`, `free`, `unknown` (accounts that existed before tracking began).

**An admin-assigned plan is never treated as evidence of payment.** Revenue is expected only for `paid`, `legacy` and `trial` periods.

## Financial definitions and units

- **Units.** Invoice amounts are in integer cents (`*_cents`). Metered compute is in millionths of a dollar (`*_micros`). Currency is USD; other currencies are excluded from period totals with a warning, never converted.
- **Null means unknown, never zero.** Unpriced usage, a missing cost rate, or an unknown Polar fee all make the dependent total null and add a warning.
- **Retail usage** is customer usage valued at the retail rate in effect when each session started. It is not our cost, and included compute consumed is **not revenue**. (`getRetailUsage` in `usage.ts`, formerly `getComputeCosts`, returns this retail value.)
- **Overage billable** is the period's overage under its own terms, using billing's rule from `money.ts`: usage beyond the included compute, less the plan discount, rounded down to whole cents. It is zero when pay-as-you-go was off.
- **Revenue measures:**
  - `invoiced_net` is the net (excluding tax) of Polar orders created in the period, at their latest state.
  - `collected_net` is the paid subset of that. **Refunds are not deducted** from it; they're reported as `refunded_net`.
  - `tax` is excluded from service revenue.
  - `payment_fee` is Polar's `platformFeeAmount` (actual, not estimated).
- **Overage invoiced.** A renewal order carries the previous period's overage. It is attributed to the period that ended at or just before the order. It's only known when `POLAR_OVERAGE_PRICE_IDS` lists the metered price ids; otherwise it is null.
- **Provider cost:**
  - Per-account cost is an **estimate**: hours × the cost rate in effect at session start.
  - Invoiced cost, credits and cash cost exist only per provider record (`provider_economics`). They are not allocated to accounts.
  - Credits never reduce the estimated (unsubsidised) cost.
- **Contribution before shared costs** = collected net − refunds − payment fees − estimated direct cost.
  - It is null unless revenue facts are complete for the category and every usage hour has a cost rate.
  - It is **not profit**: shared and fixed costs are excluded.

## Billing periods

Periods follow `resolvePeriod`: the Polar subscription period containing the instant, otherwise the UTC calendar month. Calendar months are clipped around subscription periods, so no instant belongs to two periods.

- **Terms.** Billing charges a period under the plan held at the time, so a period's terms are the account state at its end (or at the cutoff while it's open). `plan_changed_mid_period` flags periods where the plan changed partway through.
- **Which accounts get periods:**
  - Paid, legacy, trial and admin-assigned accounts get a period every billing period, including zero-usage periods.
  - Free accounts, and periods before tracking began, only get a period when they had usage, orders or product events.
  - Inactive free signups are counted through `billing_analytics_subject` (see the cohorts report).
- **Status.** A period is `open` until its end passes the rebuild cutoff, then `closed`.
- **Outcomes** for closed periods: `revoked`, `canceled`, `upgraded`, `downgraded`, `renewed` or `none`. These compare plan prices across the boundary and use cancellation and revocation events.

## Versioning and idempotency

- **Plan versions** are content hashes, so the same terms always map to the same id. Bump `TERMS_SCHEMA_VERSION` if the recorded terms change shape.
- **Account events** carry `schema_version`. Polar keys include the subscription id, status, product, period start and modified time, so a webhook replay is a no-op. A delayed delivery of an _earlier_ subscription period is ignored rather than rolling the account back.
- **Payment events** are keyed by object, status, refunded amount and modified time.
- **Usage intervals** are inserted once; later syncs only update the stop time.
- **Reports and simulations** carry `reportVersion` and `simulationVersion`.

## Periodic aggregation

The worker's billing pass (`runPeriodicTasks`, about every 10 minutes) calls `runAnalyticsTasks`:

1. Create subjects for new users.
2. Sync usage sessions started or stopped since the watermark (minus an hour of overlap), plus every open session.
3. Find the earliest period affected by facts recorded since the watermark: new intervals and account events, and payment events going back 40 days (for renewal overage). Then rebuild every period ending after the earlier of that point and _now − 40 days_.
4. Purge product events older than `BILLING_PRODUCT_EVENT_RETENTION_DAYS` (default 730).
5. Advance the watermark.

Rebuilding recomputes rows from facts, so rerunning it never double-counts. A running session counts once, up to the cutoff, and is recounted to its real stop time after it closes.

Automatic rebuilds look back at most 400 days. For older corrections, such as a late provider invoice or refund, run a manual rebuild.

At current scale this pass rebuilds all recent periods each time. If it becomes slow, restrict the rebuild to affected accounts.

## Backfill, rebuild, and cost import

Run from `packages/billing`. Every command except a dry run requires `--confirm-database <host>/<db>` matching `DATABASE_URL`.

```sh
# Preview, then backfill subjects, usage intervals, and starting snapshots
bun run billing:analytics backfill --from 2026-01-01 --dry-run
bun run billing:analytics backfill --from 2026-01-01 --batch-days 7 --confirm-database db.host:5432/gitterm
# Optional: orders and refunds from the Polar API
bun run billing:analytics backfill --polar --confirm-database …

# Rebuild summaries after a late correction
bun run billing:analytics rebuild --from 2026-01-01 --confirm-database …

# Import provider invoices or cost estimates (validated; idempotent by source record id)
bun run billing:analytics import-costs --file costs.json --dry-run
```

The backfill prints a watermark after each batch. Rerunning, or restarting from the last watermark with `--from`, is safe.

It only reconstructs what existing records establish:

| Backfilled     | Provenance                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Intervals      | `reconstructed`. The retail rate is exact (effective-dated rates); the machine spec comes from the current profile, so it's `inferred`. |
| Accounts       | One `account_snapshot` per account, `observed` at backfill time. Earlier periods show plan `unknown` instead of invented terms.         |
| Not backfilled | Plan history, alert delivery, provider costs, and revenue other than what Polar's API returns.                                          |

The `import-costs` file looks like this:

```json
{
  "costRates": [
    {
      "machineProfileId": "…",
      "perHour": 0.05,
      "currency": "USD",
      "effectiveFrom": "2026-10-01T00:00:00Z",
      "source": "provider contract, Oct 2026"
    }
  ],
  "costs": [
    {
      "providerKey": "e2b",
      "sourceRecordId": "inv_2026_09",
      "scope": "direct",
      "category": "compute",
      "periodStart": "2026-09-01T00:00:00Z",
      "periodEnd": "2026-10-01T00:00:00Z",
      "currency": "USD",
      "invoiced": 100.0,
      "credits": 100.0,
      "cash": 0,
      "status": "invoiced"
    }
  ]
}
```

- Amounts are decimal currency units.
- Omit an amount when it's unknown; don't put 0.
- Invoiced and reconciled records require `invoiced`.
- Don't enter public list prices as cost rates unless that's what you actually pay; record the rate's origin in `source`.

## Retention and deletion

- **Workspace termination** doesn't remove workspace rows, so it doesn't affect analytics.
- **User deletion** (self-service and admin) calls `onUserDeleted`, which:
  1. syncs the user's usage intervals while the sessions still exist;
  2. deletes the Polar customer, the billing account, and the `billing_analytics_subject` mapping.
- **What remains after deletion.** Intervals, account events, payment events and product events keep the `analytics_id`, which no longer resolves to the user. That is pseudonymous, not anonymous: treat it as personal data while other context could re-link it.
- **Product events** (non-financial) are purged after `BILLING_PRODUCT_EVENT_RETENTION_DAYS`.
- **Financial facts** (payments, account events, intervals) are kept for financial reporting. Decide and configure a retention period for them according to your own obligations; none is assumed here.
- **What is never collected:** repository contents, prompts, transcripts, credentials, tool output, or raw error bodies. Reason codes are structured, and cancellation reasons are Polar's enum only (no free-text comments).

## Reports and simulation (read-only)

Admin tRPC, session admin only:

- `admin.analytics.report({ request, format: "json" | "csv" })`
- `admin.analytics.simulate(scenario)`

Bot tokens and API tokens can't reach these.

**Reports:**

| Report                  | What it shows                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `account_periods`       | per-account rows, keyed by `analytics_id` only; access is logged                                                     |
| `allowance_consumption` | median/p90/p95 of consumption, exhaustion rate, days to exhaustion, pay-as-you-go rate, negative-contribution counts |
| `provider_economics`    | per provider and machine; plus imported provider costs                                                               |
| `cohorts`               | by signup month, with explicit denominators                                                                          |
| `friction`              | blocks, pauses and alerts with 7-day follow-ups; delivery outcomes; provisioning and resume reliability              |
| `runtime_modes`         | always-on vs on-demand                                                                                               |
| `data_quality`          | coverage, unlinked and unclassified orders, warnings, provenance, watermark                                          |

**Request rules:**

- Date range at most 400 days, `limit` at most 5000.
- Filters: plan, plan version, provider, machine, commercial category, runtime mode, cohort month.
- Each report runs in a `READ ONLY` transaction with a 15-second statement timeout.

**Every report returns:** `reportVersion`, `dataCutoff`, the filters used, `sampleSize`, a definition for each metric, warnings, and rows.

**Simulation:**

- It replays **closed** periods.
- The baseline is each period's own plan version, pay-as-you-go setting and spend cap.
- The scenario applies overrides by plan id (price, included compute, discount) and retail-rate multipliers (by provider and/or machine).
- It returns totals, accounts paying more or less, a breakdown by plan, provider and cohort, and warnings.
- It's labelled **"Usage and customer behaviour held constant."** It is not a forecast of demand or churn.

### Agent access without write access

Give an analysis agent one of these:

1. **An admin session** for the tRPC reports above. This is simplest, but an admin session can also call admin mutations, so prefer option 2 for automation.
2. **A read-only Postgres role** limited to the analytics tables (not `user`, `billing_account`, or `billing_analytics_subject`). The agent then sees only pseudonymous facts:

```sql
CREATE ROLE gitterm_analytics_reader LOGIN PASSWORD '…';
ALTER ROLE gitterm_analytics_reader SET default_transaction_read_only = on;
ALTER ROLE gitterm_analytics_reader SET statement_timeout = '30s';
GRANT USAGE ON SCHEMA public TO gitterm_analytics_reader;
GRANT SELECT ON billing_plan_version, billing_account_event, billing_usage_interval,
  billing_payment_event, billing_product_event, billing_provider_cost,
  billing_provider_cost_rate, billing_account_period TO gitterm_analytics_reader;
```

Point it at a read replica when one exists.

## Known gaps

- **History starts when collection starts.** Plan history, cancellations, friction, delivery and reliability before this ships are unknown. Backfilled periods show `unknown` terms.
- **Payment failures** are visible only as unpaid orders (and subscription status); Polar's webhooks here have no dedicated "payment failed" event. Disputes come from refunds with a dispute attached.
- **Overage split per order** needs `POLAR_OVERAGE_PRICE_IDS`. Without it, only total invoiced amounts are known.
- **Provider cost per account** is an estimate. Credits and cash cost aren't allocated to accounts.
- **Always-on is captured per session.** Toggling it mid-session isn't reflected.
- **Reliability latency** is the API request duration, not time until the workspace is ready.
- **Product events are best-effort.** A database failure drops the event (it is logged); customer operations never fail because of analytics.
- **No per-agent-run cost attribution.** A sandbox's cost is never split across parallel runs, and no run activity is not evidence of idle compute.
- **Simulations** don't model changed behaviour, operational changes (idle timeouts, routing), or re-applying spend caps; periods that would exceed a cap or be paused are counted in warnings instead.
