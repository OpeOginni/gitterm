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
import { checkSetup } from "./preflight.js";
import { createLocks, openStateStore, type InFlightRequest, type StateStore } from "./state.js";
import {
  minutes,
  openStatusLine,
  WAITING_FOR_ANSWER,
  WAITING_FOR_APPROVAL,
  WORKING,
  type StatusLine,
  type StatusText,
} from "./status.js";
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
  spaceOf,
  parseRepo,
  repoKey,
  repoLabel,
  type Repo,
  type WorkspaceManager,
} from "./workspaces.js";

const NETWORK_RETRIES = 5;
const ERROR_PREVIEW = 1200;
const RECENT_MESSAGES = 2000;

const COMMANDS: Record<string, RegExp> = {
  stop: /^(stop|cancel)$/i,
  reset: /^reset$/i,
  status: /^status$/i,
  help: /^help$/i,
};

/** One request: the thread it came from, who asked, and its status line. */
type Job = {
  key: string;
  thread: ChatThread;
  status: StatusLine;
  requester: ChatUser;
  repo: Repo;
  /** The request's message, for ✅/❌; absent for runs reattached after a restart. */
  message?: ChatMessage;
};

type OpenPrompt = {
  prompt: ChatPrompt;
  key: string;
  finish(result: { answer: ChatAnswer; by: ChatUser } | null): void;
};

const threadKeyOf = (thread: ChatThread) => `${thread.channel}:${thread.thread}`;
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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  const extraRepos = (options.repos ?? []).map(parseRepo);
  const allowedUsers = options.allowedUsers ? new Set(options.allowedUsers) : undefined;
  const model = typeof options.model === "string" ? { id: options.model } : options.model;
  const channelRepos = new Map(
    Object.entries(options.channels ?? {}).map(([channel, repo]) => [channel, parseRepo(repo)]),
  );
  const knownRepos = [
    ...new Map(
      [defaultRepo, ...channelRepos.values(), ...extraRepos]
        .filter((repo): repo is Repo => Boolean(repo))
        .map((repo) => [repoKey(repo), repo]),
    ).values(),
  ];
  if (knownRepos.length === 0) {
    throw new Error("Give the bot a `repo`, `repos` to choose from, or a repository per channel.");
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
  let ready = Promise.resolve();
  /** Aborted by `stop()`: run observers detach and leave their runs to the next `start()`. */
  let shutdown = new AbortController();

  const allowed = (user: ChatUser) =>
    (!user.guest || options.allowGuests === true) && (!allowedUsers || allowedUsers.has(user.id));
  const servesChannel = (channel: string) =>
    channelRepos.has(channel) || Boolean(defaultRepo) || extraRepos.length > 0;

  /**
   * A thread's repository: the one its session already works on, else one the message names
   * ("in acme/api"), else the channel's. Undefined when the person has to say which.
   */
  function repoFor(message: ChatMessage): Repo | undefined {
    const session = store.session(threadKeyOf(message.thread));
    const current = session && knownRepos.find((repo) => repoKey(repo) === session.repo);
    if (current) return current;
    const text = message.text.toLowerCase();
    // `acme/api` or the repository URL as a whole word: not `acme/api-v2` or a file path.
    // Slack wraps links as <url> or <url|text>.
    const named = knownRepos.find((repo) => {
      const names = [repoLabel(repo), repo.url.replace(/\.git$/, "")].map((name) =>
        escapeRegExp(name.toLowerCase()),
      );
      return new RegExp(`(^|[\\s(\\[<])(${names.join("|")})(?=$|[\\s.,;:!?)\\]>|])`).test(text);
    });
    return named ?? channelRepos.get(message.thread.channel) ?? defaultRepo;
  }
  const say = (thread: ChatThread, text: string) => adapter.post(thread, text).catch(noop);

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
    const { status } = job;
    const stopping = shutdown.signal;
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
      status.set(request.kind === "permission" ? WAITING_FOR_APPROVAL : WAITING_FOR_ANSWER);
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
        if (relays.size === 0) status.set(WORKING);
      }
    };

    const seen = new Set<string>();
    try {
      let completed: AgentRun | undefined;
      for (let attempt = 0; !completed; attempt++) {
        try {
          for await (const event of gitterm.runs.events(run, {
            signal: AbortSignal.any([timeout.signal, shutdown.signal]),
          })) {
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
      if (job.message) await adapter.mark?.(job.message, "done").catch(noop);
    } catch (error) {
      // Stopped: the run carries on in GitTerm and stays in the state file for the next start.
      if (stopping.aborted) return;
      const timedOut = timeout.signal.aborted;
      // A failed or cancelled run is already over; anything else would leave it running unseen.
      if (!(error instanceof AgentRunError)) await gitterm.runs.cancel(run).catch(noop);
      if (!entry.stoppedBy && !timedOut) {
        log.error("Agent run did not complete", { thread: job.key }, error);
      }
      await status.finish(describeFailure(error, { stoppedBy: entry.stoppedBy, timedOut }));
      if (job.message) await adapter.mark?.(job.message, "failed").catch(noop);
    } finally {
      clearTimeout(timer);
      for (const controller of relays.values()) {
        controller.abort(
          stopping.aborted
            ? "The bot stopped before anyone answered; it asks again when it is back."
            : "The run ended before anyone answered.",
        );
      }
      status.stop();
      active.delete(job.key);
      if (!stopping.aborted) await store.setInFlight(job.key, undefined);
    }
  }

  // ── Requests ─────────────────────────────────────────────────────────────────────────────

  async function startRun(job: Job, message: ChatMessage) {
    const report = (status: StatusText) => job.status.set(status);
    const space = spaceOf(message);
    const workspace = await lock(`repo:${space}:${repoKey(job.repo)}`, () =>
      workspaces.ensure(job.repo, report, space),
    );
    report(WORKING);
    const stored = store.session(job.key);
    // A session from a sandbox that has since been reset cannot be continued.
    const session = stored?.workspaceId === workspace.id ? stored : undefined;
    const history = message.inThread
      ? (await adapter.history(job.thread, session?.lastMessageId)).filter(
          (entry) =>
            entry.id !== message.id &&
            entry.id !== job.status.messageId &&
            (!session || !entry.fromBot),
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
      ...(model ? { model: model.id } : {}),
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
      repo: repoKey(job.repo),
      workspaceId: workspace.id,
      runId: run.id,
      lastMessageId: message.id,
    });
    return run;
  }

  async function handleRequest(message: ChatMessage, repo: Repo) {
    const key = threadKeyOf(message.thread);
    const status = await openStatusLine(adapter, message.thread);
    const job: Job = {
      key,
      thread: message.thread,
      status,
      requester: message.author,
      repo,
      message,
    };
    const request: InFlightRequest = {
      thread: job.thread,
      ...(status.messageId ? { statusId: status.messageId } : {}),
      requester: job.requester,
      repo: repoKey(repo),
    };
    await store.setInFlight(key, request);
    let run: AgentRun;
    try {
      run = await startRun(job, message);
    } catch (error) {
      log.error("Could not start an agent run", { thread: key }, error);
      await status.finish(describeFailure(error));
      await adapter.mark?.(message, "failed").catch(noop);
      await store.setInFlight(key, undefined);
      return;
    }
    await store.setInFlight(key, { ...request, run: { workspaceId: run.workspaceId, id: run.id } });
    log.info("Agent run started", { thread: key, run: run.id, repo: repoKey(repo) });
    await follow(job, run);
  }

  const askForRepo = (thread: ChatThread) =>
    say(
      thread,
      `Which repository? Mention me again and name one of: ${knownRepos.map(repoLabel).join(", ")}.`,
    );

  async function command(name: string, message: ChatMessage, repo: Repo | undefined) {
    const key = threadKeyOf(message.thread);
    if (name === "stop") {
      const current = active.get(key);
      if (!current) return say(message.thread, "Nothing is running in this thread.");
      current.stoppedBy = message.author;
      await gitterm.runs.cancel(current.run);
      return;
    }
    if (name === "help" || !repo) {
      const others = knownRepos.filter((entry) => !repo || repoKey(entry) !== repoKey(repo));
      return say(
        message.thread,
        [
          repo
            ? `I run a coding agent on ${repoLabel(repo)} in a GitTerm sandbox.`
            : "I run a coding agent in a GitTerm sandbox.",
          others.length
            ? `Name a repository in a thread's first message to work on it instead: ${others.map(repoLabel).join(", ")}.`
            : "",
          "Mention me with a question or a task; every thread is its own session, so follow up in the thread.",
          "Commands: *stop* cancels the work in this thread, *status* shows what I can access, *reset* replaces the sandbox with a fresh one.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    if (name === "reset") {
      const space = spaceOf(message);
      const terminated = await lock(`repo:${space}:${repoKey(repo)}`, () =>
        workspaces.reset(repo, space),
      );
      return say(
        message.thread,
        terminated
          ? `Terminated the ${repoLabel(repo)} sandbox. The next message creates a fresh one; threads start new sessions.`
          : `There is no ${repoLabel(repo)} sandbox yet; the next message creates one.`,
      );
    }
    // status: what this thread can reach, so people can check before asking.
    const workspace = await workspaces.find(repo, spaceOf(message));
    const sandbox = workspace
      ? `${workspace.status}${workspace.status === "paused" ? ", wakes with the next message" : ""}`
      : "created with the next message";
    return say(
      message.thread,
      [
        `*${repoLabel(repo)}*${repo.branch ? ` (${repo.branch})` : ""} · sandbox ${sandbox}`,
        `Model: ${model?.id ?? "dashboard default"} · Tools: ${options.connections?.length ? options.connections.join(", ") : "GitHub only"}`,
        message.direct
          ? "This conversation has its own sandbox."
          : `Who can use me: ${allowedUsers ? `${allowedUsers.size} allowed people` : "everyone in this channel"}${options.allowGuests ? "" : ", no guests"}`,
        active.has(key) ? "An agent is working in this thread right now." : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  function onMessage(message: ChatMessage) {
    const key = threadKeyOf(message.thread);
    if (!servesChannel(message.thread.channel) || !fresh(`${key}:${message.id}`)) return;
    if (!allowed(message.author)) {
      if (message.mentioned) {
        void say(message.thread, "Sorry, I only take requests from people my admin allowed.");
      }
      return;
    }
    const name = message.mentioned
      ? Object.keys(COMMANDS).find((entry) =>
          COMMANDS[entry]?.test(message.text.trim().replace(/[.!]+$/, "")),
        )
      : undefined;
    const repo = repoFor(message);
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
    if (!repo) {
      void askForRepo(message.thread);
      return;
    }
    void adapter.mark?.(message, "seen").catch(noop);
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
        const lost = "I restarted before this started. Please mention me again.";
        await (
          request.statusId
            ? adapter.edit(request.thread, request.statusId, lost)
            : adapter.post(request.thread, lost)
        ).catch(noop);
        await store.setInFlight(key, undefined);
        continue;
      }
      const job: Job = {
        key,
        thread: request.thread,
        status: await openStatusLine(adapter, request.thread, request.statusId),
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
      shutdown = new AbortController();
      store = await openStateStore(
        resolvePath(options.stateFile ?? `.gitterm-bot/${adapter.platform}.json`),
      );
      // Fail here, with what to fix, rather than at the first mention.
      await checkSetup({
        gitterm,
        repos: knownRepos,
        connections: options.connections ?? [],
        model,
        overrides: options.workspace,
        log,
      });
      let markReady = noop as () => void;
      ready = new Promise<void>((resolve) => (markReady = resolve));
      const started = await adapter.start({
        // Messages that arrive while the bot finishes starting wait for it.
        message: (message) => void ready.then(() => onMessage(message)),
        answer(promptId, answer, by) {
          const open = prompts.get(promptId);
          if (!open || open.prompt.kind !== answer.kind) return "stale";
          if (!allowed(by)) return "forbidden";
          open.finish({ answer, by });
          return "answered";
        },
        prompt: (promptId) => prompts.get(promptId)?.prompt,
        accepts: servesChannel,
      });
      scope = started.scope;
      workspaces = createWorkspaceManager({
        gitterm,
        platform: adapter.platform,
        scope,
        connections: options.connections ?? [],
        env: options.env ?? {},
        setup: options.setup ?? [],
        model,
        instructions: agentInstructions(adapter.displayName, options.instructions),
        overrides: options.workspace,
        log,
      });
      markReady();
      // Best effort: the dashboard offers these channels; older servers don't take them.
      void adapter
        .channels?.()
        .then((channels) => gitterm.bots.reportChannels(channels))
        .catch(noop);
      await recover();
      log.info(
        `GitTerm ${adapter.displayName} bot is running for ${knownRepos.map(repoLabel).join(", ")}.`,
      );
    },
    // Runs keep going in GitTerm and stay in the state file; the next start reattaches to them
    // and asks open questions again.
    async stop() {
      shutdown.abort();
      await adapter.stop();
    },
  };
}
