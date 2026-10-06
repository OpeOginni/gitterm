import { db, sql } from "@gitterm/db";
import { billingProductEvent } from "@gitterm/db/schema/billing-analytics";
import { ensureSubject } from "./subjects";

/** Bump when the meaning of product event fields changes. */
const PRODUCT_EVENT_SCHEMA_VERSION = 1;

export type ProductEventType =
  | "run_denied"
  | "workspace_paused_for_spending"
  | "alert_threshold_reached"
  | "alert_delivery"
  | "provision_result"
  | "resume_result";

export interface ProductEventInput {
  userId: string;
  eventType: ProductEventType;
  workspaceId?: string | null;
  reasonCode?: string | null;
  outcome?: string | null;
  occurredAt?: Date;
  planVersionId?: string | null;
  policy?: {
    includedCents: number | null;
    usedCents: number | null;
    reserveCents: number | null;
    overageCents: number | null;
    spendCapCents: number | null;
    payAsYouGo: boolean | null;
  };
  latencyMs?: number | null;
  providerKey?: string | null;
  dedupeKey?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Record a friction or reliability event. Best-effort: these events are
 * not financial facts, so a failure is logged and never breaks the
 * customer operation being observed.
 */
export async function recordProductEvent(input: ProductEventInput): Promise<void> {
  try {
    const analyticsId = await ensureSubject(input.userId);
    if (!analyticsId) return;
    await db
      .insert(billingProductEvent)
      .values({
        analyticsId,
        workspaceId: input.workspaceId ?? null,
        eventType: input.eventType,
        schemaVersion: PRODUCT_EVENT_SCHEMA_VERSION,
        reasonCode: input.reasonCode ?? null,
        outcome: input.outcome ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        planVersionId: input.planVersionId ?? null,
        includedCents: input.policy?.includedCents ?? null,
        usedCents: input.policy?.usedCents ?? null,
        reserveCents: input.policy?.reserveCents ?? null,
        overageCents: input.policy?.overageCents ?? null,
        spendCapCents: input.policy?.spendCapCents ?? null,
        payAsYouGo: input.policy?.payAsYouGo ?? null,
        latencyMs: input.latencyMs == null ? null : Math.round(input.latencyMs),
        providerKey: input.providerKey ?? null,
        dedupeKey: input.dedupeKey ?? null,
        metadata: input.metadata ?? null,
      })
      .onConflictDoNothing({ target: billingProductEvent.dedupeKey });
  } catch (error) {
    console.error(`[billing] Failed to record ${input.eventType} event`, error);
  }
}

/** Delete non-financial events older than the retention window. */
export async function purgeProductEvents(retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  // Timestamps are stored without a time zone as UTC, so bind an ISO string.
  const result = await db.execute(
    sql`delete from billing_product_event where occurred_at < ${cutoff.toISOString()}::timestamp`,
  );
  return result.rowCount ?? 0;
}
