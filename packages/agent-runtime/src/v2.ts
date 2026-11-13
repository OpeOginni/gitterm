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
  FileTooLargeError,
  isSessionNotFound,
  observing,
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

/** A background job as OpenCode lists it. */
type JobInfo = Awaited<
  ReturnType<ReturnType<typeof createOpencodeClient>["experimental"]["job"]["list"]>
>[number];

/** How long a prompt waits for a freshly started OpenCode to list its model. */
const MODEL_READY_MS = 30_000;
/** Cancelling stops within this, inside the callers' own two-second limit. */
const ABORT_SETTLE_MS = 1_500;
const ABORT_POLL_MS = 50;

/** OpenCode 2 through `@opencode/client` (`{ id, type, data }` events, questions as forms). */
export function createV2Runtime(target: RuntimeTarget): OpencodeRuntime {
  const client = createOpencodeClient(target);
  const options = () => requestTimeout(target.signal);
  // Reading a run's state is not use of the workspace. While a run is working, the run
  // watcher records that itself.
  const reading = () => observing(target.signal);

  async function switchSessionOptions(sessionID: string, agent?: string, model?: string) {
    const modelRef = parseModelRef(model);
    if (modelRef) {
      await call(
        client.session.switchModel(
          {
            sessionID,
            model: {
              providerID: modelRef.providerID,
              id: modelRef.modelID,
              variant: modelRef.variant,
            },
          },
          options(),
        ),
      );
    }
    if (agent) await call(client.session.switchAgent({ sessionID, agent }, options()));
  }

  /**
   * OpenCode fills its model catalog asynchronously after it starts. A prompt that arrives first
   * never runs (it logs "Model unavailable" and doesn't retry), so wait until the model is listed.
   */
  async function modelReady(model: { providerID: string; modelID: string }) {
    const deadline = Date.now() + MODEL_READY_MS;
    for (;;) {
      const { data } = await call(
        client.model.list({ location: { directory: target.directory } }, options()),
      );
      if (data.some((entry) => entry.providerID === model.providerID && entry.id === model.modelID))
        return;
      if (Date.now() >= deadline)
        throw new Error(
          `OpenCode does not offer ${model.providerID}/${model.modelID}; check the model ID and its credential`,
        );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return {
    async createSession(input) {
      const modelRef = parseModelRef(input.model);
      const created = await call(
        client.session.create(
          {
            title: input.title,
            agent: input.agent,
            model: modelRef
              ? { providerID: modelRef.providerID, id: modelRef.modelID, variant: modelRef.variant }
              : undefined,
            location: { directory: target.directory },
          },
          options(),
        ),
      );
      return { id: created.id, title: created.title ?? input.title ?? "Agent run" };
    },

    async prompt(input) {
      const modelRef = parseModelRef(input.model);
      if (modelRef) await modelReady(modelRef);
      await switchSessionOptions(input.sessionId, input.agent, input.model);
      await call(
        client.session.prompt(
          {
            sessionID: input.sessionId,
            id: input.messageId,
            text: input.prompt,
            files: input.files,
          },
          options(),
        ),
      );
    },

    async abort(sessionID) {
      // Interrupting a session leaves its subagents running, and every subagent that stops
      // reports back, which wakes the session again. Like `opencode run`, keep stopping the
      // session and its subagents until nothing is left that would wake it. One deadline bounds
      // every request, so nothing is interrupted after the caller has given up.
      const deadline = AbortSignal.timeout(ABORT_SETTLE_MS);
      const bounded = () =>
        requestTimeout(AbortSignal.any([deadline, ...(target.signal ? [target.signal] : [])]));
      try {
        // Every subagent below the session, whichever run started it: any of them can wake it.
        const subagents = new Set(await subtree([sessionID], bounded()));
        for (let round = 0; ; round++) {
          const { live: jobs } = await liveJobs(
            sessionID,
            (
              await call(client.experimental.job.list({ sessionID, descendants: true }, bounded()))
            ).filter((job) => job.kind === "subagent" || job.sessionID !== sessionID),
            bounded(),
          );
          for (const job of jobs) {
            if (job.sessionID !== sessionID) subagents.add(job.sessionID);
            if (job.kind === "subagent") subagents.add(job.childSessionID);
          }
          const wakes = await pendingWakes(sessionID, [...subagents], bounded());
          const active = await call(client.session.active(bounded()));
          const working = [sessionID, ...subagents].filter((id) => id in active);
          if (round > 0 && jobs.length === 0 && !wakes && working.length === 0) return;
          const interrupt = new Set(round === 0 ? [sessionID, ...working] : working);
          for (const job of jobs)
            if (job.kind === "subagent" && job.status === "running")
              interrupt.add(job.childSessionID);
          await Promise.all([
            ...[...interrupt].map((id) =>
              call(client.session.interrupt({ sessionID: id }, bounded())),
            ),
            // A shell a subagent left running would wake it, and through it this session.
            ...jobs.flatMap((job) =>
              job.kind === "shell" && job.status === "running"
                ? [
                    call(
                      client.shell.remove(
                        { id: job.shellID, location: { directory: target.directory } },
                        bounded(),
                      ),
                    ),
                  ]
                : [],
            ),
          ]);
          await new Promise((resolve) => setTimeout(resolve, ABORT_POLL_MS));
          deadline.throwIfAborted();
        }
      } catch (error) {
        if (deadline.aborted) throw new Error("OpenCode kept working after the run was cancelled");
        throw error;
      }
    },

    async deleteSession(sessionID) {
      await call(client.session.remove({ sessionID }, options()));
    },

    async snapshot(sessionID, messageId) {
      try {
        await call(client.session.get({ sessionID }, reading()));
      } catch (error) {
        if (isSessionNotFound(error)) return missingSessionSnapshot();
        throw error;
      }
      const [read, permissions, forms] = await Promise.all([
        listRunMessages(sessionID, messageId),
        call(client.permission.list({ sessionID }, reading())),
        call(client.session.form.list({ sessionID }, reading())),
      ]);
      const since = asRecord(read.find((message) => message.id === messageId)?.time).created;
      const children = subagentSessions(selectRunMessages(read, messageId));
      // The subagents this run started and theirs; older subagents belong to earlier runs.
      const tree = [
        ...children,
        ...(await subtree(children, reading(), typeof since === "number" ? since : undefined)),
      ];
      const { busy, subagents, lost } = await runBusy(sessionID, tree, since);
      // The session may have finished more work between the first read and finding it quiet;
      // only messages read after that are its final state.
      const messages = busy ? read : await listRunMessages(sessionID, messageId);

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
        busy,
        subagents,
        lostWork: lost,
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

    async readFile(path, maxBytes) {
      const send = target.fetch ?? fetch;
      let size = 0;
      // The client buffers the whole body, so the limit is enforced on the stream under it.
      const bounded = createOpencodeClient({
        ...target,
        fetch: (async (input, init) => {
          const response = await send(input, init);
          if (!response.body) return response;
          const counted = response.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                size += chunk.byteLength;
                if (size > maxBytes) controller.error(new FileTooLargeError(maxBytes));
                else controller.enqueue(chunk);
              },
            }),
          );
          return new Response(counted, response);
        }) as typeof fetch,
      });
      try {
        return await call(
          bounded.file.read(
            { location: { directory: target.directory }, path },
            requestTimeout(target.signal, 60_000),
          ),
        );
      } catch (error) {
        throw size > maxBytes ? new FileTooLargeError(maxBytes) : error;
      }
    },
  };

  /**
   * Whether the session is working, or work the run started will wake it again: subagents run
   * in the background and report back to the session when they go idle. That work moves from
   * a job to an inbox to an active session, so they are read in that order and none is missed
   * between reads.
   */
  async function runBusy(sessionID: string, tree: string[], since: unknown) {
    const { live: jobs, lost } = await liveJobs(
      sessionID,
      (
        await call(client.experimental.job.list({ sessionID, descendants: true }, reading()))
      ).filter(
        (job) =>
          (job.kind === "subagent" || job.sessionID !== sessionID) &&
          // Older runs' subagents belong to those runs.
          (typeof since !== "number" || job.time.started >= since),
      ),
      reading(),
    );
    const subagents = jobs.flatMap((job) =>
      job.kind === "subagent" && job.status === "running"
        ? [{ id: job.childSessionID, description: job.description }]
        : [],
    );
    if (jobs.length > 0) return { busy: true, subagents, lost };
    if (await pendingWakes(sessionID, tree, reading())) return { busy: true, subagents, lost };
    const active = await call(client.session.active(reading()));
    return { busy: [sessionID, ...tree].some((id) => id in active), subagents, lost };
  }

  /**
   * The jobs that are still doing something. After OpenCode restarts it can keep listing a
   * job as running whose subagent no longer runs or whose shell is gone, and nothing will
   * ever finish it. Such a job is still listed as running after its subagent was seen idle or
   * its shell missing; a job that really ended in the meantime is not.
   */
  async function liveJobs<Job extends JobInfo>(
    sessionID: string,
    jobs: Job[],
    requestOptions: ReturnType<typeof options>,
  ): Promise<{ live: Job[]; lost: boolean }> {
    const running = jobs.filter(
      (job) => job.status === "running" && (job.kind === "subagent" || job.kind === "shell"),
    );
    if (running.length === 0) return { live: jobs, lost: false };
    const active = await call(client.session.active(requestOptions));
    const shells = running.some((job) => job.kind === "shell")
      ? new Set(
          (
            await call(
              client.shell.list({ location: { directory: target.directory } }, requestOptions),
            )
          ).data.map((shell) => shell.id),
        )
      : new Set<string>();
    const unseen = running.filter((job) =>
      job.kind === "subagent"
        ? !(job.childSessionID in active)
        : job.kind === "shell" && !shells.has(job.shellID),
    );
    if (unseen.length === 0) return { live: jobs, lost: false };
    const again = new Map(
      (
        await call(client.experimental.job.list({ sessionID, descendants: true }, requestOptions))
      ).map((job) => [job.id, job.status]),
    );
    const lost = new Set(
      unseen.filter((job) => again.get(job.id) === "running").map((job) => job.id),
    );
    return { live: jobs.filter((job) => !lost.has(job.id)), lost: lost.size > 0 };
  }

  /**
   * Whether a subagent's report waits in the inbox of the session or one of its subagents.
   * OpenCode removes a subagent's job before the report wakes its parent, so only the inbox
   * shows it then. Other input (prompts, shell notices) marks its session active before its
   * job goes, so the job or `active` already shows it. Counting only reports also leaves out
   * notes that never wake anything, like those OpenCode parks with `resume: false` after a
   * restart.
   */
  async function pendingWakes(
    sessionID: string,
    subagents: string[],
    requestOptions: ReturnType<typeof options>,
  ) {
    const [own, ...theirs] = await Promise.all(
      [sessionID, ...subagents].map((id) =>
        call(client.session.inbox.list({ sessionID: id }, requestOptions)),
      ),
    );
    return [own!, ...theirs].some((items) => items.some(isSubagentReport));
  }

  /**
   * The sessions below `roots`: their subagents, those subagents' own, and so on. `since`
   * leaves out sessions created before it.
   */
  async function subtree(
    roots: string[],
    requestOptions: ReturnType<typeof options>,
    since?: number,
  ): Promise<string[]> {
    const found = new Set<string>();
    const queue = [...roots];
    for (let parentID = queue.shift(); parentID; parentID = queue.shift()) {
      let cursor: string | undefined;
      do {
        const page = await call(
          client.session.list({ parentID, limit: 100, cursor }, requestOptions),
        );
        for (const session of page.data) {
          if (found.has(session.id) || (since !== undefined && session.time.created < since))
            continue;
          found.add(session.id);
          queue.push(session.id);
        }
        cursor = page.cursor.next ?? undefined;
      } while (cursor);
    }
    return [...found];
  }

  /**
   * The run's prompt and everything after it, oldest first. Pages are read newest first
   * and stop at the prompt, so a snapshot costs the size of the run, not of the session.
   */
  async function listRunMessages(
    sessionID: string,
    messageId: string,
  ): Promise<Record<string, unknown>[]> {
    const limit = 50;
    const messages: Record<string, unknown>[] = [];
    // The server rejects `order` together with `cursor`, so only the first page states it.
    let cursor: string | undefined;
    while (true) {
      const page = await call(
        client.message.list(
          cursor ? { sessionID, cursor, limit } : { sessionID, order: "desc", limit },
          reading(),
        ),
      );
      messages.push(...page.data);
      if (page.data.some((message) => message.id === messageId)) break;
      const next = page.cursor.next ?? null;
      if (!next || page.data.length < limit) break;
      cursor = next;
    }
    return messages.reverse();
  }
}

/** A `<subagent>` report waiting in a parent's inbox; it wakes the parent when delivered. */
function isSubagentReport(item: unknown): boolean {
  const record = asRecord(item);
  return (
    record.type === "synthetic" && asRecord(asRecord(record.payload).metadata).source === "subagent"
  );
}

/** The subagent sessions a run's messages started or followed up. */
export function subagentSessions(messages: Record<string, unknown>[]): string[] {
  const sessions = new Set<string>();
  for (const message of messages) {
    for (const item of Array.isArray(message.content) ? message.content.map(asRecord) : []) {
      if (item.type !== "tool" || item.name !== "subagent") continue;
      const state = asRecord(item.state);
      const id =
        asString(asRecord(state.metadata).sessionID) ?? asString(asRecord(state.input).sessionID);
      if (id) sessions.add(id);
    }
  }
  return [...sessions];
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
