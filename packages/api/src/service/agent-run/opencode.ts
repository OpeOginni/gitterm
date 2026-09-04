import { createOpencodeClient, type Part } from "@opencode-ai/sdk";
import type { AgentRunMessagePart } from "@gitterm/db/schema/agent-run";
import { truncateToolOutput } from "./runtime/types";

export function isOpencodeRunMessage(
  info: { id: string; role: "user" } | { id: string; role: "assistant"; parentID: string },
  messageId: string,
): boolean {
  return info.id === messageId || (info.role === "assistant" && info.parentID === messageId);
}

export function snapshotParts(parts: Part[]): AgentRunMessagePart[] {
  const result: AgentRunMessagePart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (!part.ignored && part.text.trim()) result.push({ type: "text", text: part.text });
    } else if (part.type === "tool") {
      const state = part.state;
      result.push({
        type: "tool",
        callId: part.callID,
        tool: part.tool,
        status: state.status,
        title: "title" in state && state.title ? state.title : null,
        input: state.input,
        output: state.status === "completed" ? truncateToolOutput(state.output) : null,
        error: state.status === "error" ? state.error : null,
        startedAt: "time" in state ? new Date(state.time.start).toISOString() : null,
        completedAt:
          (state.status === "completed" || state.status === "error") && state.time.end
            ? new Date(state.time.end).toISOString()
            : null,
      });
    }
  }
  return result;
}

export function findLastOpencodeRunAssistant<
  T extends {
    info: { id: string; role: "user" } | { id: string; role: "assistant"; parentID: string };
  },
>(messages: readonly T[], messageId: string): T | undefined {
  return messages.findLast(
    (message) => message.info.role === "assistant" && isOpencodeRunMessage(message.info, messageId),
  );
}

export function formatOpencodeError(
  error: unknown,
  model?: { providerID: string; modelID: string },
): string {
  if (!error) return "OpenCode request failed";
  if (typeof error === "string") return error;
  let message: string | undefined;
  if (typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: unknown; providerID?: unknown } }).data;
    if (typeof data?.message === "string") message = data.message;
    const name = "name" in error ? (error as { name?: unknown }).name : undefined;
    const providerID = typeof data?.providerID === "string" ? data.providerID : model?.providerID;
    const authenticationFailed =
      name === "ProviderAuthError" ||
      (message ? /invalid api key|authentication|unauthorized/i.test(message) : false);
    if (authenticationFailed && providerID) {
      const selectedModel = model ? ` for model "${model.providerID}/${model.modelID}"` : "";
      return `Model provider credential "${providerID}" was rejected${selectedModel}: ${message ?? "Authentication failed"}`;
    }
  }
  return message ?? JSON.stringify(error) ?? "OpenCode request failed";
}

export function createWorkspaceOpencodeClient(input: {
  url: string;
  directory: string;
  password?: string | null;
}) {
  const authorization = input.password
    ? `Basic ${Buffer.from(`opencode:${input.password}`).toString("base64")}`
    : undefined;
  return createOpencodeClient({
    baseUrl: input.url,
    directory: input.directory,
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}
