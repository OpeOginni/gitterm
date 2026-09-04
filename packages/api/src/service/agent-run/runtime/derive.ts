import type { agentRunStatusEnum } from "@gitterm/db/schema/agent-run";
import type { RuntimeSnapshot } from "./types";

export type AgentRunStatus = (typeof agentRunStatusEnum.enumValues)[number];

export const ACTIVE_RUN_STATUSES = ["pending", "running", "retrying", "awaiting_input"] as const;
export const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled"] as const;

/** Grace before a prompted session with no assistant message counts as failed. */
export const MISSING_ASSISTANT_GRACE_MS = 10_000;

export function isActiveRunStatus(status: string): boolean {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}

export function isTerminalRunStatus(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export type DerivedRunState = { status: AgentRunStatus; errorMessage: string | null };

export function deriveRunState(
  snapshot: RuntimeSnapshot,
  context: { submittedAt: Date | null; sessionError?: string | null; now?: number },
): DerivedRunState {
  if (!snapshot.sessionExists) {
    return { status: "cancelled", errorMessage: "Session was deleted before the run completed" };
  }
  const assistantError = snapshot.assistant.error;
  if (assistantError?.kind === "aborted") {
    return { status: "cancelled", errorMessage: assistantError.message };
  }
  if (assistantError) return { status: "failed", errorMessage: assistantError.message };
  if (snapshot.pendingInputs.length > 0) return { status: "awaiting_input", errorMessage: null };
  if (snapshot.retry) return { status: "retrying", errorMessage: null };
  if (snapshot.busy) return { status: "running", errorMessage: null };
  if (!snapshot.assistant.exists) {
    if (context.sessionError) return { status: "failed", errorMessage: context.sessionError };
    const now = context.now ?? Date.now();
    const waited = context.submittedAt ? now - context.submittedAt.getTime() : 0;
    if (context.submittedAt && waited >= MISSING_ASSISTANT_GRACE_MS) {
      return {
        status: "failed",
        errorMessage: "OpenCode stopped before producing an assistant response",
      };
    }
    return { status: "running", errorMessage: null };
  }
  if (!snapshot.assistant.completed) return { status: "running", errorMessage: null };
  return { status: "completed", errorMessage: null };
}
