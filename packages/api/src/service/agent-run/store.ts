import { and, db, eq, inArray } from "@gitterm/db";
import { agentRun, type AgentRun } from "@gitterm/db/schema/agent-run";
import { RUN_LIFECYCLE_EVENTS } from "../../events/run-lifecycle";
import { publicRun } from "./public";
import { ACTIVE_RUN_STATUSES } from "./runtime";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function publishRun(run: AgentRun) {
  RUN_LIFECYCLE_EVENTS.publish(run.id, { type: "run.updated", run: publicRun(run) });
}

export async function loadRun(runId: string): Promise<AgentRun | undefined> {
  const [row] = await db.select().from(agentRun).where(eq(agentRun.id, runId)).limit(1);
  return row;
}

/** Whoever settles first wins; undefined when someone else already did. */
export async function settleRun(
  runId: string,
  patch: {
    status: "failed" | "cancelled";
    errorMessage: string | null;
    nativeSessionId?: string | null;
  },
): Promise<AgentRun | undefined> {
  const now = new Date();
  const [updated] = await db
    .update(agentRun)
    .set({ ...patch, pendingInputs: [], completedAt: now, updatedAt: now })
    .where(and(eq(agentRun.id, runId), inArray(agentRun.status, [...ACTIVE_RUN_STATUSES])))
    .returning();
  if (updated) publishRun(updated);
  return updated;
}

export const trackableRunColumns = {
  id: agentRun.id,
  workspaceId: agentRun.workspaceId,
  nativeSessionId: agentRun.nativeSessionId,
  nativeMessageId: agentRun.nativeMessageId,
  submittedAt: agentRun.submittedAt,
  status: agentRun.status,
  pendingInputs: agentRun.pendingInputs,
};

export type TrackableRun = Pick<AgentRun, keyof typeof trackableRunColumns>;
