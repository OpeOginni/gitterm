import type { AgentRun } from "@gitterm/db/schema/agent-run";

export function publicRun(run: AgentRun) {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    title: run.title,
    status: run.status,
    error: run.errorMessage,
    finalText: run.finalText,
    pendingInputs: run.pendingInputs,
    context: run.parentRunId
      ? { type: "continued" as const, runId: run.parentRunId }
      : { type: "isolated" as const },
    createdAt: run.createdAt.toISOString(),
    submittedAt: run.submittedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

export type PublicAgentRun = ReturnType<typeof publicRun>;
