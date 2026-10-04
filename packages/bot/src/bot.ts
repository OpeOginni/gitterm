import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import {
  AgentRunError,
  createGittermClient,
  GittermError,
  WorkspaceLifecycleError,
  type AgentRun,
  type AgentRunAttachment,
  type AgentRunInputRequest,
  type AgentRunReply,
  type GittermClient,
  type RunRef,
} from "@gitterm/sdk";
import {
  agentInstructions,
  buildPrompt,
  interpretPermissionReply,
  interpretTypedAnswer,
} from "./prompt.js";
import { createLocks, openStateStore, type InFlightRequest, type StateStore } from "./state.js";
import type {
  Bot,
  BotOptions,
  ChatAnswer,
  ChatFile,
  ChatMessage,
  ChatPrompt,
  ChatThread,
  ChatUser,
} from "./types.js";
import {
  createWorkspaceManager,
  parseRepo,
  repoKey,
  repoLabel,
  type Repo,
  type WorkspaceManager,
} from "./workspaces.js";

const STATUS_TICK_MS = 60_000;
const NETWORK_RETRIES = 5;
const ERROR_PREVIEW = 1200;
const RECENT_MESSAGES = 2000;

const COMMANDS: Record<string, RegExp> = {
  stop: /^(stop|cancel)$/i,
  reset: /^reset$/i,
  status: /^status$/i,
  help: /^help$/i,
};

/** One request: a thread, its status line, and (once created) its run. */
type Job = {
  key: string;
  thread: ChatThread;
  statusId: string;
  requester: ChatUser;
  repo: Repo;
};

type OpenPrompt = {
  prompt: ChatPrompt;
  key: string;
  finish(result: { answer: ChatAnswer; by: ChatUser } | null): void;
};

const threadKeyOf = (thread: ChatThread) => `${thread.channel}:${thread.thread}`;
const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
const noop = () => undefined;
const isClient = (value: BotOptions["gitterm"]): value is GittermClient =>
  typeof value === "object" && value !== null && "runs" in value;

function describeAnswer(answer: ChatAnswer): string {
  if (answer.kind === "question") return answer.labels.join(", ");
  return { once: "allowed once", always: "always allowed", reject: "denied" }[answer.response];
}

function describeFailure(
  error: unknown,
  outcome: { stoppedBy?: ChatUser; timedOut?: boolean } = {},
): string {
  if (outcome.stoppedBy) return `Stopped by ${outcome.stoppedBy.name}.`;
  if (outcome.timedOut) return "This took too long, so I stopped the agent. Try a smaller request.";
  if (error instanceof AgentRunError) {
    if (error.code === "RUN_CANCELLED") return "The run was cancelled.";
    const reason = error.run.error ? `: ${error.run.error.slice(0, ERROR_PREVIEW)}` : ".";
    return `The agent failed${reason}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Something went wrong: ${message.slice(0, ERROR_PREVIEW)}`;
}

async function attachmentsFor(files: ChatFile[]) {
  return Promise.all(
    files.map(
      async (file): Promise<AgentRunAttachment> => ({
        name: file.name,
        mime: file.mime,
        data: await file.download(),
      }),
    ),
  );
}

/** Remembers recently handled message ids, because platforms redeliver events. */
function recentIds(limit: number) {
  const ids = new Set<string>();
  return (id: string): boolean => {
    if (ids.has(id)) return false;
    ids.add(id);
    if (ids.size > limit) ids.delete(ids.values().next().value as string);
    return true;
  };
}

/**
 * A chat bot backed by GitTerm sandboxes: one sandbox per repository that pauses when idle and
 * wakes on the next message, and one OpenCode session per chat thread.
 */
export function createBot(options: BotOptions): Bot {
  const { adapter } = options;
  const log = options.logger ?? console;
  const gitterm = isClient(options.gitterm)
    ? options.gitterm
    : createGittermClient(options.gitterm);
  const runTimeoutMs = options.runTimeoutMs ?? 60 * 60_000;
  const inputTimeoutMs = options.inputTimeoutMs ?? 30 * 60_000;
  const defaultRepo = options.repo ? parseRepo(options.repo) : undefined;
  const channelRepos = new Map(
    Object.entries(options.channels ?? {}).map(([channel, repo]) => [channel, parseRepo(repo)]),
  );
  if (!defaultRepo && channelRepos.size === 0) {
    throw new Error("Give the bot a `repo`, or a repository per channel in `channels`.");
  }

  const lock = createLocks();
  const fresh = recentIds(RECENT_MESSAGES);
  /** Runs in progress by thread, with who asked to stop them. */
  const active = new Map<string, { run: RunRef; stoppedBy?: ChatUser }>();
  const prompts = new Map<string, OpenPrompt>();
  const threadPrompts = new Map<string, string>();
  let store: StateStore;
  let workspaces: WorkspaceManager;
  let scope = "";

  const repoFor = (channel: string) => channelRepos.get(channel) ?? defaultRepo;
  const say = (thread: ChatThread, text: string) => adapter.post(thread, text).catch(noop);

  // ── Status line ────────────────────────────────────────────────────────────────────────────

  /** The request's single status message: ticks while the agent works, then is replaced. */
  function statusLine(job: Job) {
    const startedAt = Date.now();
    let text = "Working on it…";
    let done = false;
    const render = () => {
      const elapsed = Date.now() - startedAt;
      const suffix = elapsed >= STATUS_TICK_MS ? ` (${minutes(elapsed)} min)` : "";
      return adapter.edit(job.thread, job.statusId, `${text}${suffix}`).catch(noop);
    };
    const timer = setInterval(() => void render(), STATUS_TICK_MS);
    // Prompts can close after the run ended; nothing may overwrite the final line.
    const end = () => {
      done = true;
      clearInterval(timer);
    };
    return {
      set(next: string) {
        if (done || next === text) return;
        text = next;
        void render();
      },
      async finish(final: string) {
        end();
        await adapter.edit(job.thread, job.statusId, final).catch(noop);
      },
      async remove() {
        end();
        await adapter.remove(job.thread, job.statusId).catch(noop);
      },
      stop: end,
    };
  }

  // ── Prompts (questions and permissions) ───────────────────────────────────────────────────

  async function ask(
    job: Job,
    prompt: ChatPrompt,
    signal: AbortSignal,
  ): Promise<ChatAnswer | null> {
    if (signal.aborted) return null;
    const messageId = await adapter.ask(job.thread, prompt);
    const result = await new Promise<{ answer: ChatAnswer; by: ChatUser } | null>((resolve) => {
      const finish = (value: { answer: ChatAnswer; by: ChatUser } | null) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        prompts.delete(prompt.id);
        if (threadPrompts.get(job.key) === prompt.id) threadPrompts.delete(job.key);
        resolve(value);
      };
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), inputTimeoutMs);
      prompts.set(prompt.id, { prompt, key: job.key, finish });
      threadPrompts.set(job.key, prompt.id);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const outcome = result
      ? `${result.by.name}: ${describeAnswer(result.answer)}`
      : signal.aborted
        ? String(signal.reason)
        : `No answer within ${minutes(inputTimeoutMs)} min, so the agent moved on.`;
    await adapter.settle(job.thread, messageId, prompt, outcome).catch(noop);
    return result?.answer ?? null;
  }

  /** A typed reply to the thread's open prompt. True when the message was meant for it. */
  function answerTyped(key: string, message: ChatMessage): boolean {
    const promptId = threadPrompts.get(key);
    const open = promptId ? prompts.get(promptId) : undefined;
    if (!open) return false;
    if (!message.mentioned && message.author.id !== open.prompt.requester.id) return false;
    if (open.prompt.kind === "permission") {
      const response = interpretPermissionReply(message.text);
      if (!response) {
        void say(message.thread, "Reply *yes*, *always*, or *no*, or use the buttons above.");
        return true;
      }
      open.finish({ answer: { kind: "permission", response }, by: message.author });
      return true;
    }
    const labels = interpretTypedAnswer(open.prompt.question, message.text);
    if (!labels) {
      void say(
        message.thread,
        "That does not match any option. Press a button or reply with the option's number.",
      );
      return true;
    }
    open.finish({ answer: { kind: "question", labels }, by: message.author });
    return true;
  }

  // ── Following a run ──────────────────────────────────────────────────────────────────────

  /** Show the agent's question or permission request in the thread and turn the answer into a reply. */
  async function replyTo(
    job: Job,
    request: AgentRunInputRequest,
    signal: AbortSignal,
  ): Promise<AgentRunReply> {
    if (request.kind === "permission") {
      const answer = await ask(
        job,
        { id: randomUUID(), kind: "permission", request, requester: job.requester },
        signal,
      );
      return {
        type: "permission",
        response: answer?.kind === "permission" ? answer.response : "reject",
      };
    }
    const answers: Record<string, string[]> = {};
    for (const [index, question] of request.questions.entries()) {
      const answer = await ask(
        job,
        {
          id: randomUUID(),
          kind: "question",
          question,
          index,
          total: request.questions.length,
          requester: job.requester,
        },
        signal,
      );
      if (answer?.kind !== "question") return { type: "question", reject: true };
      answers[question.key] = answer.labels;
    }
    return { type: "question", answers };
  }

  async function follow(job: Job, run: RunRef): Promise<void> {
    const status = statusLine(job);
    const entry: { run: RunRef; stoppedBy?: ChatUser } = { run };
    active.set(job.key, entry);
    const startedAt = Date.now();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), runTimeoutMs);
    // Prompts are relayed concurrently with the event stream, so the run ending or a request
    // being answered elsewhere closes the prompt in the thread right away.
    const relays = new Map<string, AbortController>();
    const relay = async (request: AgentRunInputRequest) => {
      const controller = new AbortController();
      relays.set(request.id, controller);
      status.set(
        request.kind === "permission"
          ? "Waiting for approval below…"
          : "Waiting for an answer below…",
      );
      try {
        const reply = await replyTo(job, request, controller.signal);
        if (controller.signal.aborted) return;
        await gitterm.runs
          .respond(run, { requestId: request.id, reply })
          .catch((error: unknown) => {
            // Someone answered elsewhere (e.g. in the OpenCode UI) while the prompt was open.
            if (!(error instanceof GittermError && error.code === "INPUT_NOT_PENDING")) throw error;
          });
      } catch (error) {
        log.warn("Could not relay an agent prompt", { thread: job.key }, error);
      } finally {
        relays.delete(request.id);
        if (relays.size === 0) status.set("Working on it…");
      }
    };

    const seen = new Set<string>();
    try {
      let completed: AgentRun | undefined;
      for (let attempt = 0; !completed; attempt++) {
        try {
          for await (const event of gitterm.runs.events(run, { signal: timeout.signal })) {
            if (event.type === "input.required" && !seen.has(event.request.id)) {
              seen.add(event.request.id);
              void relay(event.request);
            } else if (event.type === "input.resolved") {
              relays.get(event.requestId)?.abort("Answered outside this thread.");
            } else if (event.type === "run.completed") {
              completed = event.run;
              break;
            } else if (event.type === "run.failed") {
              throw new AgentRunError(event.run, "RUN_FAILED");
            } else if (event.type === "run.cancelled") {
              throw new AgentRunError(event.run, "RUN_CANCELLED");
            }
          }
          if (!completed) throw new GittermError("NETWORK", "The run's event stream ended early");
        } catch (error) {
          // The event stream can drop (server deploy, network); the run itself carries on.
          const dropped = error instanceof GittermError && error.code === "NETWORK";
          if (!dropped || attempt >= NETWORK_RETRIES || entry.stoppedBy) throw error;
          await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
        }
      }
      await adapter.reply(
        job.thread,
        completed.finalText?.trim() || "Done. The agent finished without a written reply.",
        `${repoLabel(job.repo)} · ${minutes(Date.now() - startedAt)} min · GitTerm`,
      );
      await status.remove();
    } catch (error) {
      const timedOut = timeout.signal.aborted;
      // A failed or cancelled run is already over; anything else would leave it running unseen.
      if (!(error instanceof AgentRunError)) await gitterm.runs.cancel(run).catch(noop);
      if (!entry.stoppedBy && !timedOut) {
        log.error("Agent run did not complete", { thread: job.key }, error);
      }
      await status.finish(describeFailure(error, { stoppedBy: entry.stoppedBy, timedOut }));
    } finally {
      clearTimeout(timer);
      for (const controller of relays.values()) {
        controller.abort("The run ended before anyone answered.");
      }
      status.stop();
      active.delete(job.key);
      await store.setInFlight(job.key, undefined);
    }
  }

  // ── Requests ─────────────────────────────────────────────────────────────────────────────

  async function startRun(job: Job, message: ChatMessage, report: (text: string) => void) {
    const workspace = await lock(`repo:${repoKey(job.repo)}`, () =>
      workspaces.ensure(job.repo, report),
    );
    report("Working on it…");
    const stored = store.session(job.key);
    // A session from a sandbox that has since been reset cannot be continued.
    const session = stored?.workspaceId === workspace.id ? stored : undefined;
    const history = message.inThread
      ? (await adapter.history(job.thread, session?.lastMessageId)).filter(
          (entry) =>
            entry.id !== message.id && entry.id !== job.statusId && (!session || !entry.fromBot),
        )
      : [];
    const prompt = buildPrompt({
      platform: adapter.displayName,
      message,
      history,
      continued: Boolean(session),
    });
    const attachments = await attachmentsFor(prompt.images);
    const input = {
      workspace: workspace.id,
      idempotencyKey: `${adapter.platform}:${scope}:${job.key}:${message.id}`,
      prompt: prompt.text,
      ...(attachments.length ? { attachments } : {}),
      title: (message.text || `Message from ${adapter.displayName}`).slice(0, 120),
      ...(options.model ? { model: options.model } : {}),
      ...(session
        ? {
            context: {
              type: "continue" as const,
              run: { workspaceId: workspace.id, id: session.runId },
            },
          }
        : {}),
    };
    const run = await gitterm.runs.create(input).catch(async (error: unknown) => {
      // The sandbox can pause again between waking it and submitting; wake it once more.
      if (!(error instanceof WorkspaceLifecycleError) || error.code !== "WORKSPACE_NOT_RUNNING") {
        throw error;
      }
      await gitterm.workspaces.ensureRunning(workspace.id);
      return gitterm.runs.create(input);
    });
    await store.setSession(job.key, {
      workspaceId: workspace.id,
      runId: run.id,
      lastMessageId: message.id,
    });
    return run;
  }

  async function handleRequest(message: ChatMessage, repo: Repo) {
    const key = threadKeyOf(message.thread);
    const statusId = await adapter.post(message.thread, "Working on it…");
    const job: Job = { key, thread: message.thread, statusId, requester: message.author, repo };
    const request: InFlightRequest = {
      thread: job.thread,
      statusId,
      requester: job.requester,
      repo: repoKey(repo),
    };
    await store.setInFlight(key, request);
    let run: AgentRun;
    try {
      run = await startRun(
        job,
        message,
        (text) => void adapter.edit(job.thread, statusId, text).catch(noop),
      );
    } catch (error) {
      log.error("Could not start an agent run", { thread: key }, error);
      await adapter.edit(job.thread, statusId, describeFailure(error)).catch(noop);
      await store.setInFlight(key, undefined);
      return;
    }
    await store.setInFlight(key, { ...request, run: { workspaceId: run.workspaceId, id: run.id } });
    log.info("Agent run started", { thread: key, run: run.id, repo: repoKey(repo) });
    await follow(job, run);
  }

  async function command(name: string, message: ChatMessage, repo: Repo) {
    const key = threadKeyOf(message.thread);
    if (name === "stop") {
      const current = active.get(key);
      if (!current) return say(message.thread, "Nothing is running in this thread.");
      current.stoppedBy = message.author;
      await gitterm.runs.cancel(current.run);
      return;
    }
    if (name === "reset") {
      const terminated = await lock(`repo:${repoKey(repo)}`, () => workspaces.reset(repo));
      return say(
        message.thread,
        terminated
          ? `Terminated the ${repoLabel(repo)} sandbox. The next message creates a fresh one; threads start new sessions.`
          : `There is no ${repoLabel(repo)} sandbox yet; the next message creates one.`,
      );
    }
    if (name === "status") {
      const workspace = await workspaces.find(repo);
      const state = workspace
        ? `is ${workspace.status}${workspace.status === "paused" ? " and wakes up with the next message" : ""}`
        : "does not exist yet; the next message creates it";
      const running = active.has(key) ? " An agent is working in this thread." : "";
      return say(message.thread, `The ${repoLabel(repo)} sandbox ${state}.${running}`);
    }
    return say(
      message.thread,
      [
        `I run a coding agent on ${repoLabel(repo)} in a GitTerm sandbox. Mention me with a question or a task; every thread is its own session, so follow up in the thread.`,
        "Commands: *stop* cancels the work in this thread, *status* shows the sandbox, *reset* replaces the sandbox with a fresh one.",
      ].join("\n"),
    );
  }

  function onMessage(message: ChatMessage) {
    const key = threadKeyOf(message.thread);
    const repo = repoFor(message.thread.channel);
    if (!repo || !fresh(`${key}:${message.id}`)) return;
    const name = message.mentioned
      ? Object.keys(COMMANDS).find((entry) =>
          COMMANDS[entry]?.test(message.text.trim().replace(/[.!]+$/, "")),
        )
      : undefined;
    // Commands come first, so "stop" works while a question is open.
    if (name) {
      void command(name, message, repo).catch((error: unknown) => {
        log.error(`The ${name} command failed`, error);
        void say(message.thread, describeFailure(error));
      });
      return;
    }
    if (answerTyped(key, message) || !message.mentioned) return;
    if (!message.text && message.files.length === 0) {
      void command("help", message, repo);
      return;
    }
    void adapter.acknowledge?.(message).catch(noop);
    // Threads run concurrently in the sandbox; messages within one thread wait their turn.
    void lock(key, () => handleRequest(message, repo)).catch((error: unknown) =>
      log.error("Request failed", { thread: key }, error),
    );
  }

  /** Requests a previous process left behind: reattach to their runs, or say they were lost. */
  async function recover() {
    for (const [key, request] of Object.entries(store.inFlight())) {
      const repo = parseRepo(request.repo);
      if (!request.run) {
        await adapter
          .edit(
            request.thread,
            request.statusId,
            "I restarted before this started. Please mention me again.",
          )
          .catch(noop);
        await store.setInFlight(key, undefined);
        continue;
      }
      const job: Job = {
        key,
        thread: request.thread,
        statusId: request.statusId,
        requester: request.requester,
        repo,
      };
      log.info("Reattaching to an agent run after a restart", { thread: key, run: request.run.id });
      void lock(key, () => follow(job, request.run as RunRef)).catch((error: unknown) =>
        log.error("Reattaching failed", { thread: key }, error),
      );
    }
  }

  return {
    async start() {
      store = await openStateStore(
        resolvePath(options.stateFile ?? `.gitterm-bot/${adapter.platform}.json`),
      );
      const started = await adapter.start({
        message: onMessage,
        answer(promptId, answer, by) {
          const open = prompts.get(promptId);
          if (!open || open.prompt.kind !== answer.kind) return false;
          open.finish({ answer, by });
          return true;
        },
        prompt: (promptId) => prompts.get(promptId)?.prompt,
        accepts: (channel) => Boolean(repoFor(channel)),
      });
      scope = started.scope;
      workspaces = createWorkspaceManager({
        gitterm,
        platform: adapter.platform,
        scope,
        connections: options.connections ?? "auto",
        instructions: agentInstructions(adapter.displayName, options.instructions),
        overrides: options.workspace,
        log,
      });
      await recover();
      const repos = [defaultRepo, ...channelRepos.values()].filter(Boolean) as Repo[];
      log.info(
        `GitTerm ${adapter.displayName} bot is running for ${[...new Set(repos.map(repoLabel))].join(", ")}.`,
      );
    },
    // Open prompts stay in the state file's runs; the next start reattaches and asks again.
    async stop() {
      await adapter.stop();
    },
  };
}
