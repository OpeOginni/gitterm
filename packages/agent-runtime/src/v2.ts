import type {
  AgentRunInputRequest,
  AgentRunMessagePart,
  AgentRunMessageSnapshot,
} from "./contract";
import { normalizeQuestion } from "./normalize";
import {
  asRecord,
  asString,
  asStringArray,
  call,
  createOpencodeClient,
  isSessionNotFound,
  requestTimeout,
  unwrapClientError,
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

/** OpenCode 2 through `@opencode/client` (`{ id, type, data }` events, questions as forms). */
export function createV2Runtime(target: RuntimeTarget): OpencodeRuntime {
  const client = createOpencodeClient(target);
  const options = () => requestTimeout(target.signal);

  async function switchSessionOptions(sessionID: string, agent?: string, model?: string) {
    const modelRef = parseModelRef(model);
    if (modelRef) {
      await call(
        client.session.switchModel(
          { sessionID, model: { providerID: modelRef.providerID, id: modelRef.modelID } },
          options(),
        ),
      );
    }
    if (agent) await call(client.session.switchAgent({ sessionID, agent }, options()));
  }

  return {
    async createSession(input) {
      const modelRef = parseModelRef(input.model);
      const created = await call(
        client.session.create(
          {
            title: input.title,
            agent: input.agent,
            model: modelRef ? { providerID: modelRef.providerID, id: modelRef.modelID } : undefined,
            location: { directory: target.directory },
          },
          options(),
        ),
      );
      return { id: created.id, title: created.title ?? input.title ?? "Agent run" };
    },

    async prompt(input) {
      await switchSessionOptions(input.sessionId, input.agent, input.model);
      await call(
        client.session.prompt(
          { sessionID: input.sessionId, id: input.messageId, text: input.prompt },
          options(),
        ),
      );
    },

    async abort(sessionID) {
      await call(client.session.interrupt({ sessionID }, options()));
    },

    async deleteSession(sessionID) {
      await call(client.session.remove({ sessionID }, options()));
    },

    async snapshot(sessionID, messageId) {
      try {
        await call(client.session.get({ sessionID }, options()));
      } catch (error) {
        if (isSessionNotFound(error)) return missingSessionSnapshot();
        throw error;
      }
      const [active, messages, permissions, forms] = await Promise.all([
        call(client.session.active(options())),
        listMessages(sessionID),
        call(client.permission.list({ sessionID }, options())),
        call(client.session.form.list({ sessionID }, options())),
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
        busy: sessionID in active,
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
          : [...permissions.map(permissionRequest), ...forms.map(formRequest)],
      };
    },

    async *subscribe(signal) {
      try {
        for await (const event of client.event.subscribe({ signal })) {
          if (event.type === "server.connected") {
            yield { type: "connected" };
            continue;
          }
          const parsed = parseV2Signal(event);
          if (parsed) yield parsed;
        }
        // The shared event source ends quietly on abort; callers expect the stream to throw.
        signal.throwIfAborted();
      } catch (error) {
        throw unwrapClientError(error);
      }
    },

    async replyPermission(sessionID, requestID, decision) {
      await call(client.permission.reply({ sessionID, requestID, decision }, options()));
    },

    async replyQuestion(sessionID, request: QuestionInputRequest, answers) {
      const answer: Record<string, string | string[]> = {};
      request.questions.forEach((question, index) => {
        const selected = (answers[index] ?? []).map((label) => optionValue(question, label));
        answer[question.key] = question.multiple ? selected : (selected[0] ?? "");
      });
      await call(client.session.form.reply({ sessionID, formID: request.id, answer }, options()));
    },

    async rejectQuestion(sessionID, formID) {
      await call(client.session.form.cancel({ sessionID, formID }, options()));
    },
  };

  async function listMessages(sessionID: string): Promise<Record<string, unknown>[]> {
    const limit = 200;
    const messages: Record<string, unknown>[] = [];
    // The server rejects `order` together with `cursor`, so only the first page states it.
    let cursor: string | undefined;
    while (true) {
      const page = await call(
        client.message.list(
          cursor ? { sessionID, cursor, limit } : { sessionID, order: "asc", limit },
          options(),
        ),
      );
      messages.push(...page.data);
      const next = page.cursor.next ?? null;
      if (!next || page.data.length < limit) break;
      cursor = next;
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
      return normalizeQuestion({
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
        custom: field.custom !== false,
      });
    }),
  };
}

function optionValue(question: QuestionInputRequest["questions"][number], label: string): string {
  const option = question.options.find((candidate) => candidate.label === label);
  return option?.value ?? label;
}

export function parseV2Signal(raw: { type: string; data?: unknown }): RuntimeSignal | null {
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
