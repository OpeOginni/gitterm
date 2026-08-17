import { createOpencodeClient, type SessionStatus } from "@opencode-ai/sdk";

export type AgentRunStatus = "running" | "retrying" | "completed" | "failed" | "cancelled";

export function mapOpencodeRunStatus(
  status: SessionStatus | undefined,
  errorName?: string,
  hasAssistantMessage = true,
): AgentRunStatus {
  if (errorName === "MessageAbortedError") return "cancelled";
  if (errorName) return "failed";
  if (status?.type === "busy") return "running";
  if (status?.type === "retry") return "retrying";
  if (!hasAssistantMessage) return "running";
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

export async function createOpencodeRun(input: {
  url: string;
  directory: string;
  password?: string | null;
  workspaceId: string;
  prompt: string;
  title?: string;
  agent?: string;
  model?: string;
}) {
  const modelSeparator = input.model?.indexOf("/") ?? -1;
  if (input.model && (modelSeparator <= 0 || modelSeparator === input.model.length - 1)) {
    throw new Error('model must use the "provider/model" format');
  }

  const client = createWorkspaceOpencodeClient(input);
  const created = await client.session.create({
    body: input.title ? { title: input.title } : undefined,
    query: { directory: input.directory },
  });
  if (created.error || !created.data) throw new Error(errorMessage(created.error));

  const prompted = await client.session.promptAsync({
    path: { id: created.data.id },
    query: { directory: input.directory },
    body: {
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
  if (prompted.error) {
    await client.session
      .delete({ path: { id: created.data.id }, query: { directory: input.directory } })
      .catch(() => undefined);
    throw new Error(errorMessage(prompted.error));
  }

  return {
    id: created.data.id,
    workspaceId: input.workspaceId,
    title: created.data.title,
    status: "running" as const,
    error: null,
    finalText: null,
  };
}

export async function getOpencodeRun(input: {
  url: string;
  directory: string;
  password?: string | null;
  workspaceId: string;
  runId: string;
}) {
  const client = createWorkspaceOpencodeClient(input);
  const [session, statuses, messages] = await Promise.all([
    client.session.get({ path: { id: input.runId }, query: { directory: input.directory } }),
    client.session.status({ query: { directory: input.directory } }),
    client.session.messages({ path: { id: input.runId }, query: { directory: input.directory } }),
  ]);
  if (session.error || !session.data) throw new Error(errorMessage(session.error));
  if (statuses.error || !statuses.data) throw new Error(errorMessage(statuses.error));
  if (messages.error || !messages.data) throw new Error(errorMessage(messages.error));

  const assistant = messages.data.findLast((message) => message.info.role === "assistant");
  const assistantError = assistant?.info.role === "assistant" ? assistant.info.error : undefined;
  const finalText = assistant?.parts
    .filter((part) => part.type === "text" && !part.ignored)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();

  return {
    id: session.data.id,
    workspaceId: input.workspaceId,
    title: session.data.title,
    status: mapOpencodeRunStatus(
      statuses.data[input.runId],
      assistantError?.name,
      Boolean(assistant),
    ),
    error: assistantError ? errorMessage(assistantError) : null,
    finalText: finalText || null,
  };
}

export async function getOpencodeRunMessages(input: {
  url: string;
  directory: string;
  password?: string | null;
  runId: string;
}) {
  const client = createWorkspaceOpencodeClient(input);
  const result = await client.session.messages({
    path: { id: input.runId },
    query: { directory: input.directory },
  });
  if (result.error || !result.data) throw new Error(errorMessage(result.error));

  return result.data.map((message) => ({
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
  }));
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

async function readWorkspaceFile(
  client: ReturnType<typeof createWorkspaceOpencodeClient>,
  directory: string,
  path: string,
): Promise<string | null> {
  try {
    const result = await client.file.read({ query: { directory, path } });
    if (result.error || !result.data || result.data.type !== "text") return null;
    return result.data.content.trim();
  } catch {
    return null;
  }
}

export async function getOpencodeSetupStatus(input: {
  url: string;
  directory: string;
  password?: string | null;
  required: boolean;
}) {
  if (!input.required) {
    return {
      status: "not_requested" as const,
      exitCode: null,
      startedAt: null,
      finishedAt: null,
      log: null,
    };
  }

  const client = createWorkspaceOpencodeClient(input);
  const state = await readWorkspaceFile(client, input.directory, ".gitterm/setup/state");
  if (!state) {
    return {
      status: "waiting" as const,
      exitCode: null,
      startedAt: null,
      finishedAt: null,
      log: null,
    };
  }

  const [exitCode, startedAt, finishedAt, log] = await Promise.all([
    readWorkspaceFile(client, input.directory, ".gitterm/setup/exit-code"),
    readWorkspaceFile(client, input.directory, ".gitterm/setup/started-at"),
    readWorkspaceFile(client, input.directory, ".gitterm/setup/finished-at"),
    readWorkspaceFile(client, input.directory, ".gitterm/setup/setup.log"),
  ]);
  const status = ["waiting", "running", "succeeded", "failed"].includes(state)
    ? (state as "waiting" | "running" | "succeeded" | "failed")
    : ("waiting" as const);
  return {
    status,
    exitCode: exitCode && /^\d+$/.test(exitCode) ? Number(exitCode) : null,
    startedAt,
    finishedAt,
    log: log?.slice(-50_000) ?? null,
  };
}
