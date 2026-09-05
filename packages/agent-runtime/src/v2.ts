import type {
  AgentRunInputRequest,
  AgentRunMessagePart,
  AgentRunMessageSnapshot,
} from "./contract";
import {
  asRecord,
  asString,
  asStringArray,
  createRuntimeHttp,
  isSessionNotFound,
  signalStream,
} from "./http";
import {
  missingSessionSnapshot,
  parseModelRef,
  permissionTitle,
  sessionStatusOf,
  truncateToolOutput,
  type OpencodeRuntime,
  type QuestionInputRequest,
  type RuntimeSignal,
  type RuntimeTarget,
} from "./types";

/** OpenCode 2 (`/api/*`, `{ id, type, data }` events, questions as forms). Verified on beta-19059. */
function session(sessionId: string): string {
  return `/api/session/${encodeURIComponent(sessionId)}`;
}

export function createV2Runtime(target: RuntimeTarget): OpencodeRuntime {
  const http = createRuntimeHttp(target);

  async function switchSessionOptions(sessionId: string, agent?: string, model?: string) {
    const modelRef = parseModelRef(model);
    if (modelRef) {
      await http.send(`${session(sessionId)}/model`, {
        method: "POST",
        json: { model: { providerID: modelRef.providerID, id: modelRef.modelID } },
      });
    }
    if (agent) {
      await http.send(`${session(sessionId)}/agent`, { method: "POST", json: { agent } });
    }
  }

  return {
    api: "v2",

    async createSession(input) {
      const modelRef = parseModelRef(input.model);
      const created = await http.json<{ data: { id: string; title?: string | null } }>(
        "/api/session",
        {
          method: "POST",
          json: {
            title: input.title,
            agent: input.agent,
            model: modelRef ? { providerID: modelRef.providerID, id: modelRef.modelID } : undefined,
            location: { directory: target.directory },
          },
        },
      );
      return { id: created.data.id, title: created.data.title ?? input.title ?? "Agent run" };
    },

    async prompt(input) {
      await switchSessionOptions(input.sessionId, input.agent, input.model);
      await http.send(`${session(input.sessionId)}/prompt`, {
        method: "POST",
        json: { id: input.messageId, text: input.prompt },
      });
    },

    async abort(sessionId) {
      await http.send(`${session(sessionId)}/interrupt`, { method: "POST", json: {} });
    },

    async deleteSession(sessionId) {
      await http.send(session(sessionId), { method: "DELETE" });
    },

    async snapshot(sessionId, messageId) {
      try {
        await http.send(session(sessionId));
      } catch (error) {
        if (isSessionNotFound(error)) return missingSessionSnapshot();
        throw error;
      }
      const [active, messages, permissions, forms] = await Promise.all([
        http.json<{ data: Record<string, unknown> }>("/api/session/active"),
        listMessages(sessionId),
        http.json<{ data: unknown[] }>(`${session(sessionId)}/permission`),
        http.json<{ data: unknown[] }>(`${session(sessionId)}/form`),
      ]);

      const runMessages = selectRunMessages(messages, messageId);
      const userIndex = messages.findIndex((message) => message.id === messageId);
      const superseded =
        userIndex >= 0 && messages.slice(userIndex + 1).some((message) => message.type === "user");
      const assistant = runMessages.findLast((message) => message.type === "assistant");
      const assistantTime = asRecord(assistant?.time);
      const assistantError = asRecord(assistant?.error);
      const finalText = assistant ? assistantText(assistant) : "";

      return {
        sessionExists: true,
        superseded,
        busy: sessionId in asRecord(active.data),
        retry: Boolean(assistant?.retry) && assistantTime.completed == null,
        messages: runMessages.map(normalizeMessage),
        finalText: finalText || null,
        assistant: {
          exists: Boolean(assistant),
          completed: assistantTime.completed != null,
          error: assistant?.error
            ? {
                kind: assistantError.type === "aborted" ? "aborted" : "error",
                message: asString(assistantError.message) ?? "Agent request failed",
              }
            : null,
        },
        pendingInputs: superseded
          ? []
          : [
              ...(permissions.data ?? []).map(asRecord).map(permissionRequest),
              ...(forms.data ?? []).map(asRecord).map(formRequest),
            ],
      };
    },

    subscribe: (signal) => signalStream(target, "/api/event", parseV2Signal, signal),

    async replyPermission(sessionId, requestId, reply) {
      await http.send(`${session(sessionId)}/permission/${encodeURIComponent(requestId)}/reply`, {
        method: "POST",
        json: { reply },
      });
    },

    async replyQuestion(sessionId, request: QuestionInputRequest, answers) {
      const answer: Record<string, string | string[]> = {};
      request.questions.forEach((question, index) => {
        const selected = (answers[index] ?? []).map((label) => optionValue(question, label));
        answer[question.key] = question.multiple ? selected : (selected[0] ?? "");
      });
      await http.send(`${session(sessionId)}/form/${encodeURIComponent(request.id)}/reply`, {
        method: "POST",
        json: { answer },
      });
    },

    async rejectQuestion(sessionId, requestId) {
      await http.send(`${session(sessionId)}/form/${encodeURIComponent(requestId)}/cancel`, {
        method: "POST",
        json: {},
      });
    },
  };

  async function listMessages(sessionId: string): Promise<Record<string, unknown>[]> {
    type MessagePage = { data?: unknown[]; cursor?: { next?: string | null } };
    const pageSize = 200;
    const messages: Record<string, unknown>[] = [];
    // The server rejects `order` together with `cursor`, so only the first page states it.
    let query: string = `?order=asc&limit=${pageSize}`;
    while (true) {
      const page: MessagePage = await http.json<MessagePage>(
        `${session(sessionId)}/message${query}`,
      );
      const items = page.data ?? [];
      messages.push(...items.map(asRecord));
      const next = page.cursor?.next ?? null;
      if (!next || items.length < pageSize) break;
      query = `?cursor=${encodeURIComponent(next)}&limit=${pageSize}`;
    }
    return messages;
  }
}

/** v2 assistant messages have no parent id: a run owns its user message through the next user message. */
export function selectRunMessages(
  messages: Record<string, unknown>[],
  messageId: string,
): Record<string, unknown>[] {
  const start = messages.findIndex((message) => message.id === messageId);
  if (start === -1) return [];
  const selected = [messages[start]!];
  for (const message of messages.slice(start + 1)) {
    if (message.type === "user") break;
    if (message.type === "assistant") selected.push(message);
  }
  return selected;
}

function assistantText(message: Record<string, unknown>): string {
  return (Array.isArray(message.content) ? message.content.map(asRecord) : [])
    .filter((item) => item.type === "text")
    .map((item) => asString(item.text) ?? "")
    .join("\n")
    .trim();
}

function toIso(value: unknown): string | null {
  return typeof value === "number" ? new Date(value).toISOString() : null;
}

export function normalizeMessage(message: Record<string, unknown>): AgentRunMessageSnapshot {
  const time = asRecord(message.time);
  const id = asString(message.id) ?? "";
  if (message.type === "user") {
    const text = asString(message.text) ?? "";
    return {
      id,
      role: "user",
      createdAt: toIso(time.created) ?? new Date().toISOString(),
      completedAt: null,
      text,
      parts: text ? [{ type: "text", text }] : [],
      error: null,
    };
  }
  const parts: AgentRunMessagePart[] = [];
  for (const item of Array.isArray(message.content) ? message.content.map(asRecord) : []) {
    if (item.type === "text") {
      const text = asString(item.text) ?? "";
      if (text.trim()) parts.push({ type: "text", text });
    } else if (item.type === "tool") {
      const state = asRecord(item.state);
      const toolTime = asRecord(item.time);
      const status = asString(state.status);
      const output = (Array.isArray(state.content) ? state.content.map(asRecord) : [])
        .filter((content) => content.type === "text")
        .map((content) => asString(content.text) ?? "")
        .join("\n");
      parts.push({
        type: "tool",
        callId: asString(item.id) ?? "",
        tool: asString(item.name) ?? "tool",
        status:
          status === "running" || status === "completed" || status === "error" ? status : "pending",
        title: asString(asRecord(state.metadata).title),
        input: typeof state.input === "object" && state.input ? asRecord(state.input) : {},
        output: status === "completed" ? truncateToolOutput(output) : null,
        error:
          status === "error" ? (asString(asRecord(state.error).message) ?? "Tool failed") : null,
        startedAt: toIso(toolTime.ran) ?? toIso(toolTime.created),
        completedAt: toIso(toolTime.completed),
      });
    }
  }
  const error = asRecord(message.error);
  return {
    id,
    role: "assistant",
    createdAt: toIso(time.created) ?? new Date().toISOString(),
    completedAt: toIso(time.completed),
    text: assistantText(message),
    parts,
    error: message.error ? (asString(error.message) ?? "Agent request failed") : null,
  };
}

/** Both the `permission.asked` payload and a `GET /api/session/{id}/permission` entry. */
export function permissionRequest(raw: Record<string, unknown>): AgentRunInputRequest {
  const action = asString(raw.action) ?? "permission";
  const patterns = asStringArray(raw.resources);
  return {
    id: asString(raw.id) ?? "",
    kind: "permission",
    createdAt: toIso(asRecord(raw.time).created),
    toolCallId: asString(asRecord(raw.source).id),
    permission: action,
    patterns,
    always: asStringArray(raw.save),
    title: permissionTitle(action, patterns),
  };
}

/** A form (`form.created` payload or `GET /api/session/{id}/form` entry) as a question request. */
export function formRequest(raw: Record<string, unknown>): AgentRunInputRequest {
  const fields = Array.isArray(raw.fields) ? raw.fields.map(asRecord) : [];
  const tool = asRecord(asRecord(raw.metadata).tool);
  return {
    id: asString(raw.id) ?? "",
    kind: "question",
    createdAt: toIso(asRecord(raw.time).created),
    toolCallId: asString(tool.id) ?? asString(tool.callID),
    questions: fields.map((field, index) => {
      const key = asString(field.key) ?? `q${index}`;
      return {
        key,
        header: asString(field.title) ?? key,
        question: asString(field.description) ?? asString(field.title) ?? key,
        options: (Array.isArray(field.options) ? field.options.map(asRecord) : []).map((option) => {
          const value = asString(option.value);
          const label = asString(option.label) ?? value ?? "";
          return {
            label,
            description: asString(option.description) ?? "",
            ...(value && value !== label ? { value } : {}),
          };
        }),
        multiple: field.type === "multiselect",
        custom: field.custom === true,
      };
    }),
  };
}

function optionValue(question: QuestionInputRequest["questions"][number], label: string): string {
  const option = question.options.find((candidate) => candidate.label === label);
  return option?.value ?? label;
}

export function parseV2Signal(raw: Record<string, unknown>): RuntimeSignal | null {
  const data = asRecord(raw.data);
  const type = asString(raw.type) ?? "";
  const sessionId = asString(data.sessionID);
  const changed = (): RuntimeSignal | null =>
    sessionId ? { type: "session.changed", sessionId } : null;

  if (type.startsWith("session.step.") || type.startsWith("session.tool.")) return changed();
  switch (type) {
    case "session.text.ended":
    case "session.reasoning.ended":
    case "session.message.content.updated":
    case "session.inbox.delivered":
      return changed();
    case "session.execution.started":
      return sessionId ? { type: "session.status", sessionId, status: "busy" } : null;
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
    case "session.idle":
      return sessionId ? { type: "session.status", sessionId, status: "idle" } : null;
    case "session.retry.scheduled":
      return sessionId ? { type: "session.status", sessionId, status: "retry" } : null;
    case "session.status": {
      const status = sessionStatusOf(asString(asRecord(data.status).type));
      return sessionId ? { type: "session.status", sessionId, status } : null;
    }
    case "session.error":
      return sessionId
        ? {
            type: "session.error",
            sessionId,
            message: asString(asRecord(data.error).message) ?? "Agent request failed",
          }
        : null;
    case "session.deleted": {
      const deleted = sessionId ?? asString(data.id) ?? asString(asRecord(data.info).id);
      return deleted ? { type: "session.deleted", sessionId: deleted } : null;
    }
    case "permission.asked":
      return sessionId
        ? { type: "input.asked", sessionId, request: permissionRequest(data) }
        : null;
    case "form.created": {
      const form = asRecord(data.form);
      const formSession = asString(form.sessionID);
      return formSession
        ? { type: "input.asked", sessionId: formSession, request: formRequest(form) }
        : null;
    }
    case "permission.replied": {
      const requestId = asString(data.requestID);
      return sessionId && requestId ? { type: "input.resolved", sessionId, requestId } : null;
    }
    case "form.replied":
    case "form.cancelled": {
      const requestId = asString(data.id);
      return sessionId && requestId ? { type: "input.resolved", sessionId, requestId } : null;
    }
    default:
      return null;
  }
}
