import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
