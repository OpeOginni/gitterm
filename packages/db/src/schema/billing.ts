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
