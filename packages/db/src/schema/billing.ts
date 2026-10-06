import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Billing state for managed deployments, owned by `@gitterm/billing`.
 * Self-hosted deployments leave this table empty. Users without a row are on
 * the free plan.
 */
export const billingAccount = pgTable("billing_account", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BillingAccountRow = typeof billingAccount.$inferSelect;
