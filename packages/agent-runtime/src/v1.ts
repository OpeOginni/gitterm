import type { AgentRunInputRequest, AgentRunMessageSnapshot } from "./contract";
import {
  createWorkspaceOpencodeClient,
  findLastOpencodeRunAssistant,
  formatOpencodeError,
  isOpencodeRunMessage,
  snapshotParts,
} from "./opencode";
import {
  asRecord,
  asString,
  asStringArray,
  createRuntimeHttp,
  signalStream,
  RuntimeHttpError,
} from "./http";
import {
  missingSessionSnapshot,
  parseModelRef,
  permissionTitle,
  sessionStatusOf,
  type OpencodeRuntime,
  type PermissionReply,
  type QuestionInputRequest,
  type RuntimeSignal,
  type RuntimeTarget,
} from "./types";

/** OpenCode 1.x: `/event`, `/session/*`, global `/permission` + `/question` lists. */
export function createV1Runtime(target: RuntimeTarget): OpencodeRuntime {
  const client = () => createWorkspaceOpencodeClient(target);
  const http = createRuntimeHttp(target);
  const directoryQuery = `?directory=${encodeURIComponent(target.directory)}`;

  return {
    api: "v1",

    async createSession(input) {
      const created = await client().session.create({
        body: input.title ? { title: input.title } : undefined,
        query: { directory: target.directory },
      });
      if (created.error || !created.data) throw new Error(formatOpencodeError(created.error));
      return { id: created.data.id, title: created.data.title };
    },

    async prompt(input) {
      const model = parseModelRef(input.model);
      const prompted = await client().session.promptAsync({
        path: { id: input.sessionId },
        query: { directory: target.directory },
        body: {
          messageID: input.messageId,
          parts: [{ type: "text", text: input.prompt }],
          agent: input.agent,
          model,
        },
      });
      if (prompted.error) throw new Error(formatOpencodeError(prompted.error));
    },

    async abort(sessionId) {
      const result = await client().session.abort({
        path: { id: sessionId },
        query: { directory: target.directory },
      });
      if (result.error) throw new Error(formatOpencodeError(result.error));
    },

    async deleteSession(sessionId) {
      const result = await client().session.delete({
        path: { id: sessionId },
        query: { directory: target.directory },
      });
      if (result.error) throw new Error(formatOpencodeError(result.error));
    },

    async snapshot(sessionId, messageId) {
      const api = client();
      const [session, statuses, messages, permissions, questions] = await Promise.all([
        api.session.get({
          path: { id: sessionId },
          query: { directory: target.directory },
          signal: target.signal,
        }),
        api.session.status({ query: { directory: target.directory }, signal: target.signal }),
        api.session.messages({
          path: { id: sessionId },
          query: { directory: target.directory },
          signal: target.signal,
        }),
        http.json<unknown>(`/permission${directoryQuery}`),
        http.json<unknown>(`/question${directoryQuery}`),
      ]);
      if (session.response.status === 404) return missingSessionSnapshot();
      if (session.error || !session.data) throw new Error(formatOpencodeError(session.error));
      if (statuses.error || !statuses.data) throw new Error(formatOpencodeError(statuses.error));
      if (messages.error || !messages.data) throw new Error(formatOpencodeError(messages.error));

      const status = statuses.data[sessionId];
      const userIndex = messages.data.findIndex((message) => message.info.id === messageId);
      const superseded =
        userIndex >= 0 &&
        messages.data.slice(userIndex + 1).some((message) => message.info.role === "user");
      const assistant = findLastOpencodeRunAssistant(messages.data, messageId);
      const assistantInfo = assistant?.info.role === "assistant" ? assistant.info : undefined;
      const assistantModel = assistantInfo
        ? { providerID: assistantInfo.providerID, modelID: assistantInfo.modelID }
        : undefined;
      const finalText = assistant ? textOf(assistant.parts) : "";

      const pendingInputs: AgentRunInputRequest[] = [
        ...(Array.isArray(permissions) ? permissions : [])
          .map(asRecord)
          .filter((permission) => permission.sessionID === sessionId)
          .map(permissionRequest),
        ...(Array.isArray(questions) ? questions : [])
          .map(asRecord)
          .filter((question) => question.sessionID === sessionId)
          .map(questionRequest),
      ];

      return {
        sessionExists: true,
        superseded,
        busy: status?.type === "busy",
        retry: status?.type === "retry",
        messages: messages.data
          .filter((message) => isOpencodeRunMessage(message.info, messageId))
          .map(
            (message): AgentRunMessageSnapshot => ({
              id: message.info.id,
              role: message.info.role,
              createdAt: new Date(message.info.time.created).toISOString(),
              completedAt:
                message.info.role === "assistant" && message.info.time.completed
                  ? new Date(message.info.time.completed).toISOString()
                  : null,
              text: textOf(message.parts),
              parts: snapshotParts(message.parts),
              error:
                message.info.role === "assistant" && message.info.error
                  ? formatOpencodeError(message.info.error, {
                      providerID: message.info.providerID,
                      modelID: message.info.modelID,
                    })
                  : null,
            }),
          ),
        finalText: finalText || null,
        assistant: {
          exists: Boolean(assistant),
          completed: assistantInfo?.time.completed != null,
          error: assistantInfo?.error
            ? {
                kind: assistantInfo.error.name === "MessageAbortedError" ? "aborted" : "error",
                message: formatOpencodeError(assistantInfo.error, assistantModel),
              }
            : null,
        },
        pendingInputs: superseded ? [] : pendingInputs,
      };
    },

    subscribe: (signal) => signalStream(target, `/event${directoryQuery}`, parseV1Signal, signal),

    async replyPermission(sessionId, requestId, reply) {
      const result = await client().postSessionIdPermissionsPermissionId({
        path: { id: sessionId, permissionID: requestId },
        query: { directory: target.directory },
        body: { response: reply satisfies PermissionReply },
      });
      if (result.response.status === 404) throw new RuntimeHttpError(404, "", null);
      if (result.error) throw new Error(formatOpencodeError(result.error));
    },

    async replyQuestion(_sessionId, request: QuestionInputRequest, answers) {
      await http.send(`/question/${encodeURIComponent(request.id)}/reply${directoryQuery}`, {
        method: "POST",
        json: { answers },
      });
    },

    async rejectQuestion(_sessionId, requestId) {
      await http.send(`/question/${encodeURIComponent(requestId)}/reject${directoryQuery}`, {
        method: "POST",
        json: {},
      });
    },
  };
}

function textOf(parts: Array<{ type: string; text?: string; ignored?: boolean }>): string {
  return parts
    .filter((part) => part.type === "text" && !part.ignored)
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

/** Both the `permission.asked` payload and a `GET /permission` entry. */
export function permissionRequest(raw: Record<string, unknown>): AgentRunInputRequest {
  const tool = asRecord(raw.tool);
  // Older 1.x servers emit `permission.updated` with `type`/`pattern`/`title`.
  const permission = asString(raw.permission) ?? asString(raw.type) ?? "permission";
  const patterns =
    asStringArray(raw.patterns).length > 0
      ? asStringArray(raw.patterns)
      : asStringArray(Array.isArray(raw.pattern) ? raw.pattern : [raw.pattern]);
  const createdMs = asRecord(raw.time).created;
  return {
    id: asString(raw.id) ?? "",
    kind: "permission",
    createdAt: typeof createdMs === "number" ? new Date(createdMs).toISOString() : null,
    toolCallId: asString(tool.callID) ?? asString(raw.callID),
    permission,
    patterns,
    always: asStringArray(raw.always),
    title: asString(raw.title) ?? permissionTitle(permission, patterns),
  };
}

/** Both the `question.asked` payload and a `GET /question` entry. */
export function questionRequest(raw: Record<string, unknown>): AgentRunInputRequest {
  const tool = asRecord(raw.tool);
  const questions = Array.isArray(raw.questions) ? raw.questions.map(asRecord) : [];
  return {
    id: asString(raw.id) ?? "",
    kind: "question",
    createdAt: null,
    toolCallId: asString(tool.callID),
    questions: questions.map((question, index) => ({
      key: `q${index}`,
      header: asString(question.header) ?? `Question ${index + 1}`,
      question: asString(question.question) ?? "",
      options: (Array.isArray(question.options) ? question.options.map(asRecord) : []).map(
        (option) => ({
          label: asString(option.label) ?? "",
          description: asString(option.description) ?? "",
        }),
      ),
      multiple: question.multiple === true,
      custom: question.custom === true,
    })),
  };
}

function changed(sessionId: string | null): RuntimeSignal | null {
  return sessionId ? { type: "session.changed", sessionId } : null;
}

export function parseV1Signal(raw: Record<string, unknown>): RuntimeSignal | null {
  const properties = asRecord(raw.properties);
  switch (raw.type) {
    case "message.updated":
    case "message.removed":
      return changed(
        asString(asRecord(properties.info).sessionID) ?? asString(properties.sessionID),
      );
    case "message.part.updated":
    case "message.part.removed":
      return changed(
        asString(asRecord(properties.part).sessionID) ?? asString(properties.sessionID),
      );
    case "session.status": {
      const sessionId = asString(properties.sessionID);
      const status = sessionStatusOf(asString(asRecord(properties.status).type));
      return sessionId ? { type: "session.status", sessionId, status } : null;
    }
    case "session.idle": {
      const sessionId = asString(properties.sessionID);
      return sessionId ? { type: "session.status", sessionId, status: "idle" } : null;
    }
    case "session.error": {
      const sessionId = asString(properties.sessionID);
      return sessionId
        ? { type: "session.error", sessionId, message: formatOpencodeError(properties.error) }
        : null;
    }
    case "session.deleted": {
      const sessionId = asString(asRecord(properties.info).id);
      return sessionId ? { type: "session.deleted", sessionId } : null;
    }
    case "permission.asked":
    case "permission.updated": {
      const sessionId = asString(properties.sessionID);
      return sessionId
        ? { type: "input.asked", sessionId, request: permissionRequest(properties) }
        : null;
    }
    case "question.asked": {
      const sessionId = asString(properties.sessionID);
      return sessionId
        ? { type: "input.asked", sessionId, request: questionRequest(properties) }
        : null;
    }
    case "permission.replied":
    case "question.replied":
    case "question.rejected": {
      const sessionId = asString(properties.sessionID);
      const requestId = asString(properties.requestID) ?? asString(properties.permissionID);
      return sessionId && requestId ? { type: "input.resolved", sessionId, requestId } : null;
    }
    default:
      return null;
  }
}
