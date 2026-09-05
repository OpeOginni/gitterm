/** Provider-independent runtime data. No control-plane or database dependencies. */
export type OpencodeApi = "v1" | "v2";
export type AgentRunStatus =
  | "pending"
  | "running"
  | "retrying"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";
export type AgentRunInputRequest = {
  id: string;
  /** Null when the runtime does not expose the original creation time. */
  createdAt: string | null;
  toolCallId: string | null;
} & (
  | { kind: "permission"; permission: string; patterns: string[]; always: string[]; title: string }
  | {
      kind: "question";
      questions: Array<{
        key: string;
        header: string;
        question: string;
        options: Array<{ label: string; description: string; value?: string }>;
        multiple: boolean;
        custom: boolean;
      }>;
    }
);
export type AgentRunMessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      callId: string;
      tool: string;
      status: "pending" | "running" | "completed" | "error";
      title: string | null;
      input: Record<string, unknown>;
      output: string | null;
      error: string | null;
      startedAt: string | null;
      completedAt: string | null;
    };
export type AgentRunMessageSnapshot = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  completedAt: string | null;
  text: string;
  error: string | null;
  parts: AgentRunMessagePart[];
};
