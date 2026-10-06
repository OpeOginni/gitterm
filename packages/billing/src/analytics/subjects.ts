import { and, db, eq, inArray, isNull, not, sql } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import { billingAnalyticsSubject } from "@gitterm/db/schema/billing-analytics";

/** Synthetic "try GitTerm" users; excluded from analytics. */
const ANON_EMAIL_PATTERN = "%@anon.gitterm.local";

/** Analytics ids for these users, creating subjects as needed. Unknown users are skipped. */
export async function ensureSubjects(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  await db
    .insert(billingAnalyticsSubject)
    .select(
      db
        .select({
          userId: user.id,
          analyticsId: sql<string>`gen_random_uuid()`.as("analytics_id"),
          userCreatedAt: user.createdAt,
          createdAt: sql<Date>`now()`.as("created_at"),
        })
        .from(user)
        .where(inArray(user.id, unique)),
    )
    .onConflictDoNothing();
  const rows = await db
    .select({
      userId: billingAnalyticsSubject.userId,
      analyticsId: billingAnalyticsSubject.analyticsId,
    })
    .from(billingAnalyticsSubject)
    .where(inArray(billingAnalyticsSubject.userId, unique));
  return new Map(rows.map((row) => [row.userId, row.analyticsId]));
}

export async function ensureSubject(userId: string): Promise<string | null> {
  return (await ensureSubjects([userId])).get(userId) ?? null;
}

/** Give every real user a subject, so cohorts count signups with no activity. */
export async function syncSubjects(): Promise<number> {
  const inserted = await db
    .insert(billingAnalyticsSubject)
    .select(
      db
        .select({
          userId: user.id,
          analyticsId: sql<string>`gen_random_uuid()`.as("analytics_id"),
          userCreatedAt: user.createdAt,
          createdAt: sql<Date>`now()`.as("created_at"),
        })
        .from(user)
        .leftJoin(billingAnalyticsSubject, eq(billingAnalyticsSubject.userId, user.id))
        .where(
          and(
            isNull(billingAnalyticsSubject.userId),
            not(sql`${user.email} like ${ANON_EMAIL_PATTERN}`),
          ),
        ),
    )
    .onConflictDoNothing()
    .returning({ userId: billingAnalyticsSubject.userId });
  return inserted.length;
}

/**
 * Remove the user-to-analytics-id link. Facts keep the analytics id, but no
 * longer resolve to the user. (The row also cascades with the user.)
 */
export async function deleteSubject(userId: string): Promise<void> {
  await db.delete(billingAnalyticsSubject).where(eq(billingAnalyticsSubject.userId, userId));
}
