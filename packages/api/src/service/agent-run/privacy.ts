import type { AgentRunInputRequest } from "@gitterm/db/schema/agent-run";

/** Keep only references needed to coordinate replies across server replicas. */
export function inputReferences(inputs: AgentRunInputRequest[]): AgentRunInputRequest[] {
  return inputs.map((input) => ({
    id: input.id,
    createdAt: input.createdAt,
    toolCallId: null,
    ...(input.kind === "permission"
      ? { kind: "permission" as const, permission: "", patterns: [], always: [], title: "" }
      : { kind: "question" as const, questions: [] }),
  }));
}
