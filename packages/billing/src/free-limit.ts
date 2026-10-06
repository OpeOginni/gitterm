import { db, eq } from "@gitterm/db";
import { systemConfig } from "@gitterm/db/schema/auth";
import { PLANS } from "./plans";

/** Free runtime is admin-tunable from the system settings page; 0 means unlimited. */
export async function getFreeDailyMinuteLimit(): Promise<number | null> {
  const [row] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, "free_tier_daily_minutes"));
  const configured = row ? Number.parseInt(row.value, 10) : PLANS.free.dailyMinutes;
  return configured && Number.isFinite(configured) && configured > 0 ? configured : null;
}
