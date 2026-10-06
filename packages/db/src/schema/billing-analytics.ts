import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

/**
 * Historical facts for pricing and customer-experience analysis, owned by
 * `@gitterm/billing` and written only in managed deployments. See
 * docs/billing-analytics.md for grain, units, and retention.
 *
 * Money is stored in integer minor units: `*_cents` for invoice amounts and
 * `*_micros` (millionths of a currency unit) for metered compute. A null
 * amount means unknown, never zero.
 */

/**
 * Pseudonymous analytical identity. This is the only link between analytics
 * facts and a user, and it is deleted with the user. Facts keep the
 * `analytics_id`, which is still potentially personal data while any
 * mapping or linkable context exists.
 */
export const billingAnalyticsSubject = pgTable("billing_analytics_subject", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  analyticsId: uuid("analytics_id").notNull().unique().defaultRandom(),
  /** Signup time, for cohorts. */
  userCreatedAt: timestamp("user_created_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Immutable commercial terms. The id is the plan id plus a hash of the
 * terms, so a period stays interpretable after plans.ts changes.
 */
export const billingPlanVersion = pgTable("billing_plan_version", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  priceCents: integer("price_cents").notNull(),
  includedComputeCents: integer("included_compute_cents"),
  overageDiscountPercent: real("overage_discount_percent").notNull(),
  dailyMinutes: integer("daily_minutes"),
  /** Entitlements in effect, schema `termsSchemaVersion`. */
  entitlements: jsonb("entitlements").$type<Record<string, unknown>>().notNull(),
  termsSchemaVersion: integer("terms_schema_version").notNull(),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
});

/**
 * Append-only commercial history: plan, period, pay-as-you-go, spend cap,
 * cancellation, and revocation changes, with who caused them and the terms
 * that applied.
 */
export const billingAccountEvent = pgTable(
  "billing_account_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analyticsId: uuid("analytics_id").notNull(),
    eventType: text("event_type").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    effectiveAt: timestamp("effective_at").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    /** polar_webhook | admin | customer | system | backfill */
    source: text("source").notNull(),
    /** customer | admin | payment_provider | system */
    actor: text("actor").notNull(),
    /** free | paid | legacy | admin_assigned | complimentary | trial | unknown */
    commercialCategory: text("commercial_category").notNull(),
    planVersionId: text("plan_version_id").references(() => billingPlanVersion.id),
    previousPlan: text("previous_plan"),
    plan: text("plan").notNull(),
    previousPayAsYouGo: boolean("previous_pay_as_you_go"),
    payAsYouGo: boolean("pay_as_you_go").notNull(),
    previousSpendCapCents: integer("previous_spend_cap_cents"),
    spendCapCents: integer("spend_cap_cents"),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    subscriptionId: text("subscription_id"),
    /** observed | reconstructed | inferred */
    provenance: text("provenance").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    /** Whitelisted fields only, e.g. a structured cancellation reason. */
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>(),
  },
  (table) => [index("billing_account_event_subject_idx").on(table.analyticsId, table.effectiveAt)],
);

/**
 * One row per usage session, copied from `usage_session` with the context
 * needed to price and explain it later. No foreign keys, so it survives
 * workspace and user deletion.
 */
export const billingUsageInterval = pgTable(
  "billing_usage_interval",
  {
    sessionId: uuid("session_id").primaryKey(),
    analyticsId: uuid("analytics_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    botId: uuid("bot_id"),
    /** bot | user: who created the workspace. */
    workload: text("workload").notNull(),
    providerKey: text("provider_key").notNull(),
    cloudProviderId: uuid("cloud_provider_id"),
    region: text("region"),
    hostingType: text("hosting_type").notNull(),
    machineProfileId: uuid("machine_profile_id"),
    machineKey: text("machine_key"),
    machineVcpus: real("machine_vcpus"),
    machineMemoryGb: real("machine_memory_gb"),
    /** observed (captured while the session was current) | inferred (backfilled) */
    machineProvenance: text("machine_provenance").notNull(),
    /** Always-on when the interval was captured. */
    alwaysOn: boolean("always_on").notNull(),
    startedAt: timestamp("started_at").notNull(),
    stoppedAt: timestamp("stopped_at"),
    stopSource: text("stop_source"),
    /**
     * Retail price in effect at session start; null when the size had no
     * price. Snapshotted because retail rates are deleted with their machine
     * profile. Cost estimates are looked up at rebuild time instead, so rates
     * entered later with an earlier effective date still apply.
     */
    retailMicrosPerHour: integer("retail_micros_per_hour"),
    /** open | closed */
    status: text("status").notNull(),
    /** observed | reconstructed */
    provenance: text("provenance").notNull(),
    firstRecordedAt: timestamp("first_recorded_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("billing_usage_interval_subject_idx").on(table.analyticsId, table.startedAt),
    index("billing_usage_interval_started_idx").on(table.startedAt),
  ],
);

/**
 * Estimated provider cost per hour of a machine size, separate from retail
 * prices. Effective-dated like `billing_machine_rate`. Not a negotiated or
 * invoiced price unless an admin entered one.
 */
export const billingProviderCostRate = pgTable(
  "billing_provider_cost_rate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    machineProfileId: uuid("machine_profile_id").notNull(),
    microsPerHour: integer("micros_per_hour"),
    currency: text("currency").notNull(),
    effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
    /** Where the number came from, e.g. "public list price" or "contract 2026-10". */
    source: text("source").notNull(),
  },
  (table) => [
    index("billing_provider_cost_rate_profile_idx").on(table.machineProfileId, table.effectiveFrom),
  ],
);

/**
 * Provider costs from invoices or usage exports, including costs that aren't
 * tied to a workspace (commitments, subscriptions, storage, network, shared
 * platform expenses). Imported idempotently by source record id.
 */
export const billingProviderCost = pgTable(
  "billing_provider_cost",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerKey: text("provider_key").notNull(),
    /** Provider account, project, or team reference. */
    accountRef: text("account_ref"),
    /** direct (compute delivered to customers) | shared (platform overhead) */
    scope: text("scope").notNull(),
    /** compute | storage | network | subscription | commitment | platform | other */
    category: text("category").notNull(),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    quantity: real("quantity"),
    unit: text("unit"),
    currency: text("currency").notNull(),
    estimatedMicros: bigint("estimated_micros", { mode: "number" }),
    invoicedMicros: bigint("invoiced_micros", { mode: "number" }),
    creditsMicros: bigint("credits_micros", { mode: "number" }),
    cashMicros: bigint("cash_micros", { mode: "number" }),
    /** estimated | invoiced | reconciled */
    status: text("status").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    note: text("note"),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_provider_cost_source_unique").on(table.providerKey, table.sourceRecordId),
  ],
);

/**
 * Append-only payment history from Polar: one row per observed state of an
 * order or refund. The latest state per object wins; earlier rows stay as
 * an audit trail.
 */
export const billingPaymentEvent = pgTable(
  "billing_payment_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null when the customer isn't linked to a known user. */
    analyticsId: uuid("analytics_id"),
    provider: text("provider").notNull(),
    providerCustomerId: text("provider_customer_id"),
    /** order | refund */
    kind: text("kind").notNull(),
    providerObjectId: text("provider_object_id").notNull(),
    orderId: text("order_id").notNull(),
    subscriptionId: text("subscription_id"),
    productId: text("product_id"),
    status: text("status").notNull(),
    /** purchase | subscription_create | subscription_cycle | subscription_update (orders) */
    billingReason: text("billing_reason"),
    currency: text("currency").notNull(),
    subtotalCents: integer("subtotal_cents"),
    discountCents: integer("discount_cents"),
    /** Excludes tax. */
    netCents: integer("net_cents"),
    taxCents: integer("tax_cents"),
    totalCents: integer("total_cents"),
    /** Overage portion of the order, when its metered price is known. */
    overageCents: integer("overage_cents"),
    refundedCents: integer("refunded_cents"),
    refundedTaxCents: integer("refunded_tax_cents"),
    /** Polar's fee as reported on the order. */
    platformFeeCents: integer("platform_fee_cents"),
    platformFeeCurrency: text("platform_fee_currency"),
    paid: boolean("paid"),
    isDispute: boolean("is_dispute").notNull().default(false),
    /** When the order or refund was created at the provider; attributes it to a period. */
    objectCreatedAt: timestamp("object_created_at").notNull(),
    /** When this state was observed at the provider (modified time, else created time). */
    occurredAt: timestamp("occurred_at").notNull(),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    /** webhook | api_backfill */
    source: text("source").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
  },
  (table) => [
    index("billing_payment_event_object_idx").on(table.providerObjectId, table.occurredAt),
    index("billing_payment_event_subject_idx").on(table.analyticsId, table.occurredAt),
  ],
);

/**
 * Spending friction and reliability: denied attempts, financial pauses,
 * usage alerts and their delivery, provisioning and resume outcomes.
 * Non-financial and best-effort; purged after the retention window.
 */
export const billingProductEvent = pgTable(
  "billing_product_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analyticsId: uuid("analytics_id").notNull(),
    workspaceId: uuid("workspace_id"),
    eventType: text("event_type").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    reasonCode: text("reason_code"),
    /** e.g. success | failure | sent | failed */
    outcome: text("outcome"),
    occurredAt: timestamp("occurred_at").notNull(),
    planVersionId: text("plan_version_id"),
    /** Policy state when the event happened (paid plans). */
    includedCents: integer("included_cents"),
    usedCents: integer("used_cents"),
    reserveCents: integer("reserve_cents"),
    overageCents: integer("overage_cents"),
    spendCapCents: integer("spend_cap_cents"),
    payAsYouGo: boolean("pay_as_you_go"),
    latencyMs: integer("latency_ms"),
    providerKey: text("provider_key"),
    /** Deduplicates state transitions (e.g. one threshold alert per period). */
    dedupeKey: text("dedupe_key").unique(),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>(),
  },
  (table) => [
    index("billing_product_event_subject_idx").on(table.analyticsId, table.occurredAt),
    index("billing_product_event_type_idx").on(table.eventType, table.occurredAt),
  ],
);

/**
 * Rebuildable summary: one row per account and billing period. Derived from
 * the fact tables above; never edited by hand.
 */
export const billingAccountPeriod = pgTable(
  "billing_account_period",
  {
    analyticsId: uuid("analytics_id").notNull(),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    /** subscription (Polar period) | calendar (UTC month) */
    periodSource: text("period_source").notNull(),
    /** open | closed */
    status: text("status").notNull(),
    planVersionId: text("plan_version_id"),
    planId: text("plan_id").notNull(),
    commercialCategory: text("commercial_category").notNull(),
    planChangedMidPeriod: boolean("plan_changed_mid_period").notNull(),
    payAsYouGo: boolean("pay_as_you_go").notNull(),
    spendCapCents: integer("spend_cap_cents"),
    priceCents: integer("price_cents"),
    includedCents: integer("included_cents"),
    computeSeconds: bigint("compute_seconds", { mode: "number" }).notNull(),
    alwaysOnSeconds: bigint("always_on_seconds", { mode: "number" }).notNull(),
    unpricedSeconds: bigint("unpriced_seconds", { mode: "number" }).notNull(),
    retailUsageMicros: bigint("retail_usage_micros", { mode: "number" }).notNull(),
    includedConsumedCents: integer("included_consumed_cents"),
    includedUnusedCents: integer("included_unused_cents"),
    /** Overage owed under the period's terms, computed with billing's own rules. */
    overageBillableCents: integer("overage_billable_cents"),
    invoicedNetCents: integer("invoiced_net_cents"),
    invoicedOverageCents: integer("invoiced_overage_cents"),
    collectedNetCents: integer("collected_net_cents"),
    refundedNetCents: integer("refunded_net_cents"),
    taxCents: integer("tax_cents"),
    paymentFeeCents: integer("payment_fee_cents"),
    costEstimateMicros: bigint("cost_estimate_micros", { mode: "number" }),
    uncostedSeconds: bigint("uncosted_seconds", { mode: "number" }).notNull(),
    /** Collected net revenue minus refunds, fees, and estimated direct cost. Null when incomplete. */
    contributionBeforeSharedCents: integer("contribution_before_shared_cents"),
    deniedAttempts: integer("denied_attempts").notNull(),
    financialPauses: integer("financial_pauses").notNull(),
    alertsReached: integer("alerts_reached").notNull(),
    alertsDelivered: integer("alerts_delivered").notNull(),
    /** renewed | upgraded | downgraded | canceled | revoked | none; null while open */
    outcome: text("outcome"),
    /** Data-quality warnings for this row. */
    warnings: text("warnings")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    rebuiltAt: timestamp("rebuilt_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.analyticsId, table.periodStart] })],
);

/** Watermarks for incremental analytics jobs. */
export const billingJobState = pgTable("billing_job_state", {
  name: text("name").primaryKey(),
  watermark: timestamp("watermark").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
