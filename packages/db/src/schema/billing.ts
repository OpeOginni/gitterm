import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { machineProfile } from "./cloud";

/**
 * Billing state for managed deployments, owned by `@gitterm/billing`.
 * Self-hosted deployments leave these tables empty. Users without an account
 * row are on the free plan.
 */
export const billingAccount = pgTable("billing_account", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(),
  /**
   * How the account got its plan: free | paid (Polar subscription) | legacy |
   * admin_assigned | complimentary | trial | unknown (predates tracking).
   * An admin-assigned plan is not evidence of payment.
   */
  commercialCategory: text("commercial_category").notNull().default("unknown"),
  /** Polar subscription id, when the plan comes from one. */
  subscriptionId: text("subscription_id"),
  /**
   * Polar's modified time of the last subscription event applied. Older events
   * (replays, late deliveries) must not overwrite a newer state.
   */
  subscriptionModifiedAt: timestamp("subscription_modified_at"),
  /** The subscription's current billing period; null falls back to the calendar month. */
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  /** Keep running past the included compute, billed as overage up to the spend cap. */
  payAsYouGo: boolean("pay_as_you_go").notNull().default(false),
  /** Most overage, in cents, the user accepts per billing period. */
  spendCapCents: integer("spend_cap_cents"),
  /** Usage alerts already sent for the period starting at `alertsPeriodStart`. */
  alertsSent: text("alerts_sent").array().notNull().default([]),
  alertsPeriodStart: timestamp("alerts_period_start"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Hourly price of a machine size, in millionths of a dollar. A new row
 * changes the price for sessions starting from `effectiveFrom`, so earlier
 * usage keeps its price. A null price means the size is not priced.
 */
export const billingMachineRate = pgTable(
  "billing_machine_rate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    machineProfileId: uuid("machine_profile_id")
      .notNull()
      .references(() => machineProfile.id, { onDelete: "cascade" }),
    microsPerHour: integer("micros_per_hour"),
    effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  },
  (table) => [
    index("billing_machine_rate_profile_idx").on(table.machineProfileId, table.effectiveFrom),
  ],
);

export type BillingAccountRow = typeof billingAccount.$inferSelect;

/**
 * Pay-as-you-go overage per billing period, settled with Polar independently of
 * the account's current settings. Earned only grows; a period is reported until
 * Polar has accepted its earned total, including after the period ends.
 */
export const billingOverage = pgTable(
  "billing_overage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    /** Overage earned while pay-as-you-go was on, in cents. Never decreases. */
    earnedCents: integer("earned_cents").notNull().default(0),
    /** Highest cumulative total Polar has accepted for this period, in cents. */
    reportedCents: integer("reported_cents").notNull().default(0),
    /** Plan terms and cap while earning, for the final count once the period ends. */
    includedCents: integer("included_cents").notNull(),
    overageDiscountPercent: integer("overage_discount_percent").notNull(),
    spendCapCents: integer("spend_cap_cents"),
    /** Whether pay-as-you-go was on at the last pass; only then is the final count billable. */
    payAsYouGo: boolean("pay_as_you_go").notNull().default(true),
    /** Set once the ended period's final usage has been counted. */
    closedAt: timestamp("closed_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.periodStart] }),
    index("billing_overage_unsettled_idx").on(table.closedAt),
  ],
);
