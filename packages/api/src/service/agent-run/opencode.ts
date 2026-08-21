import { createOpencodeClient, type SessionStatus } from "@opencode-ai/sdk";

export type AgentRunStatus = "running" | "retrying" | "completed" | "failed" | "cancelled";

export function isOpencodeRunMessage(
  info: { id: string; role: "user" } | { id: string; role: "assistant"; parentID: string },
  messageId: string,
): boolean {
  return info.id === messageId || (info.role === "assistant" && info.parentID === messageId);
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

export function mapOpencodeRunStatus(
  status: SessionStatus | undefined,
  errorName?: string,
  hasAssistantMessage = true,
  missingAssistantIsFailure = false,
  assistantCompleted = true,
): AgentRunStatus {
  if (errorName === "MessageAbortedError") return "cancelled";
  if (errorName) return "failed";
  if (status?.type === "busy") return "running";
  if (status?.type === "retry") return "retrying";
  if (hasAssistantMessage && !assistantCompleted) return "running";
  if (!hasAssistantMessage) return missingAssistantIsFailure ? "failed" : "running";
  return "completed";
}

function errorMessage(error: unknown): string {
  if (!error) return "OpenCode request failed";
  if (typeof error === "string") return error;
  if (typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: unknown } }).data;
    if (typeof data?.message === "string") return data.message;
  }
  return JSON.stringify(error) ?? "OpenCode request failed";
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

export async function createOpencodeSession(input: {
  url: string;
  directory: string;
  password?: string | null;
  title?: string;
}) {
  const client = createWorkspaceOpencodeClient(input);
  const created = await client.session.create({
    body: input.title ? { title: input.title } : undefined,
    query: { directory: input.directory },
  });
  if (created.error || !created.data) throw new Error(errorMessage(created.error));

  return { id: created.data.id, title: created.data.title };
}

export async function submitOpencodePrompt(input: {
  url: string;
  directory: string;
  password?: string | null;
  sessionId: string;
  messageId: string;
  prompt: string;
  agent?: string;
  model?: string;
}) {
  const modelSeparator = input.model?.indexOf("/") ?? -1;
  if (input.model && (modelSeparator <= 0 || modelSeparator === input.model.length - 1)) {
    throw new Error('model must use the "provider/model" format');
  }

  const client = createWorkspaceOpencodeClient(input);
  const prompted = await client.session.promptAsync({
    path: { id: input.sessionId },
    query: { directory: input.directory },
    body: {
      messageID: input.messageId,
      parts: [{ type: "text", text: input.prompt }],
      agent: input.agent,
      model: input.model
        ? {
            providerID: input.model.slice(0, modelSeparator),
            modelID: input.model.slice(modelSeparator + 1),
          }
        : undefined,
    },
  });
  if (prompted.error) throw new Error(errorMessage(prompted.error));
}

export async function getOpencodeRun(input: {
  url: string;
  directory: string;
  password?: string | null;
  workspaceId: string;
  runId: string;
  messageId: string;
  missingAssistantIsFailure?: boolean;
}) {
  const client = createWorkspaceOpencodeClient(input);
  const [session, statuses] = await Promise.all([
    client.session.get({ path: { id: input.runId }, query: { directory: input.directory } }),
    client.session.status({ query: { directory: input.directory } }),
  ]);
  if (session.error || !session.data) throw new Error(errorMessage(session.error));
  if (statuses.error || !statuses.data) throw new Error(errorMessage(statuses.error));
  const messages = await client.session.messages({
    path: { id: input.runId },
    query: { directory: input.directory },
  });
  if (messages.error || !messages.data) throw new Error(errorMessage(messages.error));

  const assistant = findLastOpencodeRunAssistant(messages.data, input.messageId);
  const assistantError = assistant?.info.role === "assistant" ? assistant.info.error : undefined;
  const missingAssistantError =
    !assistant && input.missingAssistantIsFailure
      ? "OpenCode stopped before producing an assistant response"
      : null;
  const finalText = assistant?.parts
    .filter((part) => part.type === "text" && !part.ignored)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
  const assistantCompleted =
    assistant?.info.role === "assistant" && assistant.info.time.completed != null;

  return {
    id: session.data.id,
    workspaceId: input.workspaceId,
    title: session.data.title,
    status: mapOpencodeRunStatus(
      statuses.data[input.runId],
      assistantError?.name,
      Boolean(assistant),
      input.missingAssistantIsFailure,
      assistantCompleted,
    ),
    error: assistantError ? errorMessage(assistantError) : missingAssistantError,
    finalText: finalText || null,
    messages: messages.data
      .filter((message) => isOpencodeRunMessage(message.info, input.messageId))
      .map((message) => ({
        id: message.info.id,
        role: message.info.role,
        createdAt: new Date(message.info.time.created).toISOString(),
        completedAt:
          message.info.role === "assistant" && message.info.time.completed
            ? new Date(message.info.time.completed).toISOString()
            : null,
        text: message.parts
          .filter((part) => part.type === "text" && !part.ignored)
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n")
          .trim(),
        error:
          message.info.role === "assistant" && message.info.error
            ? errorMessage(message.info.error)
            : null,
      })),
  };
}

export async function cancelOpencodeRun(input: {
  url: string;
  directory: string;
  password?: string | null;
  runId: string;
}) {
  const client = createWorkspaceOpencodeClient(input);
  const result = await client.session.abort({
    path: { id: input.runId },
    query: { directory: input.directory },
  });
  if (result.error) throw new Error(errorMessage(result.error));
  return { cancelled: result.data === true };
}

export async function deleteOpencodeSession(input: {
  url: string;
  directory: string;
  password?: string | null;
  sessionId: string;
}) {
  const client = createWorkspaceOpencodeClient(input);
  const result = await client.session.delete({
    path: { id: input.sessionId },
    query: { directory: input.directory },
  });
  if (result.error) throw new Error(errorMessage(result.error));
}
