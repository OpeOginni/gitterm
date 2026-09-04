import type { AgentRunInputRequest, AgentRunMessageSnapshot } from "@gitterm/db/schema/agent-run";
import type { OpencodeApi } from "@gitterm/db/schema/workspace";

export type RuntimeTarget = {
  url: string;
  directory: string;
  password: string | null;
  api: OpencodeApi;
};

/** Signals carry no content; the watcher re-reads a snapshot, so a missed event can't corrupt state. */
export type RuntimeSignal =
  | { type: "connected" }
  | { type: "session.changed"; sessionId: string }
  | { type: "session.status"; sessionId: string; status: "busy" | "idle" | "retry" }
  | { type: "session.error"; sessionId: string; message: string }
  | { type: "session.deleted"; sessionId: string }
  | { type: "input.asked"; sessionId: string; request: AgentRunInputRequest }
  | { type: "input.resolved"; sessionId: string; requestId: string };

export type RuntimeSnapshot = {
  sessionExists: boolean;
  /** The agent loop is still working on this session. */
  busy: boolean;
  /** OpenCode is backing off before retrying the model provider. */
  retry: boolean;
  messages: AgentRunMessageSnapshot[];
  finalText: string | null;
  assistant: {
    exists: boolean;
    completed: boolean;
    error: { kind: "aborted" | "error"; message: string } | null;
  };
  pendingInputs: AgentRunInputRequest[];
};

export type QuestionInputRequest = Extract<AgentRunInputRequest, { kind: "question" }>;

export type PermissionReply = "once" | "always" | "reject";

export interface OpencodeRuntime {
  readonly api: OpencodeApi;
  createSession(input: {
    title?: string;
    agent?: string;
    model?: string;
  }): Promise<{ id: string; title: string }>;
  prompt(input: {
    sessionId: string;
    messageId: string;
    prompt: string;
    agent?: string;
    model?: string;
  }): Promise<void>;
  abort(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  snapshot(sessionId: string, messageId: string): Promise<RuntimeSnapshot>;
  /** One connection attempt; the caller owns reconnects. */
  subscribe(signal: AbortSignal): AsyncIterable<RuntimeSignal>;
  replyPermission(sessionId: string, requestId: string, reply: PermissionReply): Promise<void>;
  replyQuestion(
    sessionId: string,
    request: QuestionInputRequest,
    answers: string[][],
  ): Promise<void>;
  rejectQuestion(sessionId: string, requestId: string): Promise<void>;
}

export function parseModelRef(model: string | undefined) {
  if (!model) return undefined;
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    throw new Error('model must use the "provider/model" format');
  }
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) };
}

export function permissionTitle(permission: string, patterns: string[]): string {
  return patterns.length > 0 ? `${permission}: ${patterns.join(", ")}` : permission;
}

export function sessionStatusOf(status: string | null): "busy" | "retry" | "idle" {
  return status === "busy" ? "busy" : status === "retry" ? "retry" : "idle";
}

export function missingSessionSnapshot(): RuntimeSnapshot {
  return {
    sessionExists: false,
    busy: false,
    retry: false,
    messages: [],
    finalText: null,
    assistant: { exists: false, completed: false, error: null },
    pendingInputs: [],
  };
}

const TOOL_OUTPUT_LIMIT = 4_000;

export function truncateToolOutput(value: string): string {
  return value.length > TOOL_OUTPUT_LIMIT
    ? `${value.slice(0, TOOL_OUTPUT_LIMIT)}\n…[truncated ${value.length - TOOL_OUTPUT_LIMIT} chars]`
    : value;
}
