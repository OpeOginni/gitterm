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
import { applySavedConfig } from "./saved.js";
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

/** A request from when it is accepted, so stop and the deadline cover every step of it. */
type PendingJob = {
  controller: AbortController;
  requester: ChatUser;
  /** The sandbox it works in (space and repository), so reset can tell what is busy. */
  sandbox: string;
  /** Set when the request starts: waiting behind the thread's earlier request doesn't count. */
  deadline?: number;
  timer?: ReturnType<typeof setTimeout>;
  run?: RunRef;
  stoppedBy?: ChatUser;
};

/** Stop waiting promptly, while the underlying operation may still need to clean up. */
async function cancellable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

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

async function attachmentsFor(files: ChatFile[], signal: AbortSignal) {
  const attachments: AgentRunAttachment[] = [];
  let total = 0;
  // Sequential downloads bound peak memory; check actual encoded size too, not just metadata.
  for (const file of files) {
    const data = await cancellable(file.download(signal), signal);
    if (data.length > 4 * Math.ceil(5_000_000 / 3) || total + data.length > 20_000_000) {
      throw new Error("Downloaded attachments exceed the image budget");
    }
    total += data.length;
    attachments.push({ name: file.name, mime: file.mime, data });
  }
  return attachments;
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

/** What the bot works from, derived from its options; replaced whole when saved settings change. */
function settingsFor(options: BotOptions) {
  const defaultRepo = options.repo ? parseRepo(options.repo) : undefined;
  const extraRepos = (options.repos ?? []).map(parseRepo);
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
  return {
    options,
    defaultRepo,
    extraRepos,
    channelRepos,
    knownRepos,
    allowedUsers: options.allowedUsers ? new Set(options.allowedUsers) : undefined,
    model: typeof options.model === "string" ? { id: options.model } : options.model,
  };
}

/**
 * A chat bot backed by GitTerm sandboxes: one sandbox per repository that pauses when idle and
 * wakes on the next message, and one OpenCode session per chat thread.
 */
export function createBot(initial: BotOptions): Bot {
  const { adapter } = initial;
  const log = initial.logger ?? console;
  const gitterm = isClient(initial.gitterm)
    ? initial.gitterm
    : createGittermClient(initial.gitterm);
  const runTimeoutMs = initial.runTimeoutMs ?? 60 * 60_000;
  const inputTimeoutMs = initial.inputTimeoutMs ?? 30 * 60_000;
  for (const [name, value, maximum] of [
    ["runTimeoutMs", runTimeoutMs, 24 * 60 * 60_000],
    ["inputTimeoutMs", inputTimeoutMs, 24 * 60 * 60_000],
    ["maxPendingRequests", initial.maxPendingRequests ?? 20, 1_000],
    ["maxPendingPerUser", initial.maxPendingPerUser ?? 3, 1_000],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
      throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  // Reassigned together by reload(); a request reads whatever is current when it gets there.
  let { options, defaultRepo, extraRepos, channelRepos, knownRepos, allowedUsers, model } =
    settingsFor(initial);

  const lock = createLocks();
  const fresh = recentIds(RECENT_MESSAGES);
  /** Runs in progress by thread, with who asked to stop them. */
  const active = new Map<string, PendingJob>();
  const pending = new Map<string, Set<PendingJob>>();
  const prompts = new Map<string, OpenPrompt>();
  const threadPrompts = new Map<string, string>();
  let store: StateStore;
  let workspaces: WorkspaceManager;
  let scope = "";
  let ready = Promise.resolve();
  let running = false;
  let leaseTimer: ReturnType<typeof setInterval> | undefined;
  let leaseId: string | undefined;
  /** When the saved settings in use were last changed in the dashboard. */
  let savedAt: string | undefined;
  const tasks = new Set<Promise<unknown>>();
  const trackTask = (task: Promise<unknown>) => {
    tasks.add(task);
    void task.finally(() => tasks.delete(task)).catch(noop);
  };
  /** Aborted by `stop()`: run observers detach and leave their runs to the next `start()`. */
  let shutdown = new AbortController();

  const allowed = (user: ChatUser) =>
    (!user.guest || options.allowGuests === true) && (!allowedUsers || allowedUsers.has(user.id));
  const canAnswer = (prompt: ChatPrompt, user: ChatUser) =>
    prompt.kind === "permission"
      ? (!user.guest || options.allowGuests === true) &&
        (options.approvers
          ? options.approvers.includes(user.id)
          : allowed(user) && user.id === prompt.requester.id)
      : allowed(user);
  const servesChannel = (channel: string) =>
    (!options.allowedChannels || options.allowedChannels.includes(channel)) &&
    (channelRepos.has(channel) || Boolean(defaultRepo) || extraRepos.length > 0);

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
  /** Starts a request's clock; it then covers waking the sandbox, submitting, and the run. */
  const startClock = (job: PendingJob, deadline = Date.now() + runTimeoutMs) => {
    job.deadline = deadline;
    job.timer = setTimeout(
      () => job.controller.abort("deadline"),
      Math.max(0, deadline - Date.now()),
    );
  };

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
    if (result)
      log.info("Agent input answered", {
        botId: options.botId,
        platform: adapter.platform,
        requesterId: job.requester.id,
        responderId: result.by.id,
        runId: active.get(job.key)?.run?.id,
        workspaceId: active.get(job.key)?.run?.workspaceId,
        kind: prompt.kind,
        ...(result.answer.kind === "permission" ? { response: result.answer.response } : {}),
      });
    await adapter.settle(job.thread, messageId, prompt, outcome).catch(noop);
    return result?.answer ?? null;
  }

  /** A typed reply to the thread's open prompt. True when the message was meant for it. */
  function answerTyped(key: string, message: ChatMessage): boolean {
    const promptId = threadPrompts.get(key);
    const open = promptId ? prompts.get(promptId) : undefined;
    if (!open) return false;
    if (!canAnswer(open.prompt, message.author)) return false;
    if (!message.mentioned && message.author.id !== open.prompt.requester.id) return false;
    if (open.prompt.kind === "permission") {
      const response = interpretPermissionReply(message.text);
      if (!response) {
        void say(message.thread, "Reply *yes*, *always*, or *no*, or use the buttons above.");
        return true;
      }
      if (response === "always" && !options.allowAlways) {
        void say(
          message.thread,
          "Persistent approvals are disabled. Reply yes for this request only, or no.",
        );
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

  async function follow(
    job: Job,
    run: RunRef,
    entry: PendingJob,
    completedRun?: AgentRun,
  ): Promise<void> {
    const { status } = job;
    const stopping = shutdown.signal;
    const working = AbortSignal.any([shutdown.signal, entry.controller.signal]);
    entry.run = run;
    active.set(job.key, entry);
    let executionCompleted = false;
    let delivered = false;
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
      let completed: AgentRun | undefined = completedRun;
      for (let attempt = 0; !completed; attempt++) {
        try {
          for await (const event of gitterm.runs.events(run, { signal: working })) {
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
          if (!dropped || attempt >= NETWORK_RETRIES || working.aborted) throw error;
          await cancellable(
            new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1))),
            working,
          );
        }
      }
      executionCompleted = true;
      try {
        if (completed.outputAvailable === false && completed.finalText === null)
          throw new Error("The run's output is unavailable");
        for (let attempt = 0; ; attempt++) {
          const request = store.inFlight()[job.key];
          try {
            await adapter.reply(
              job.thread,
              completed.finalText?.trim() || "Done. The agent finished without a written reply.",
              `${repoLabel(job.repo)} · GitTerm`,
              {
                sent: request?.deliveredParts ?? 0,
                async recordSent(sent) {
                  if (request)
                    await store.setInFlight(job.key, { ...request, deliveredParts: sent });
                },
              },
            );
            break;
          } catch (error) {
            if (attempt >= 2) throw error;
            await cancellable(
              new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1))),
              stopping,
            );
          }
        }
      } catch (error) {
        // Stopping keeps the result for the next start; otherwise say so once and move on,
        // rather than hold the thread until a restart.
        if (stopping.aborted) throw error;
        log.error("Could not post the agent's reply", { thread: job.key, run: run.id }, error);
        await say(
          job.thread,
          `The agent finished, but I couldn't post its reply here. Open run ${run.id} in GitTerm to see it.`,
        );
      }
      delivered = true;
      await status.remove();
      if (job.message) await adapter.mark?.(job.message, "done").catch(noop);
    } catch (error) {
      // Stopped: the run carries on in GitTerm and stays in the state file for the next start.
      if (stopping.aborted) return;
      if (executionCompleted) {
        log.error("Could not finish up after a run", { thread: job.key, run: run.id }, error);
        return;
      }
      const timedOut = entry.controller.signal.reason === "deadline";
      // A failed or cancelled run is already over; anything else would leave it running unseen.
      if (!(error instanceof AgentRunError)) await gitterm.runs.cancel(run).catch(noop);
      if (!entry.stoppedBy && !timedOut) {
        log.error("Agent run did not complete", { thread: job.key }, error);
      }
      await status.finish(describeFailure(error, { stoppedBy: entry.stoppedBy, timedOut }));
      if (job.message) await adapter.mark?.(job.message, "failed").catch(noop);
    } finally {
      clearTimeout(entry.timer);
      for (const controller of relays.values()) {
        controller.abort(
          stopping.aborted
            ? "The bot stopped before anyone answered; it asks again when it is back."
            : "The run ended before anyone answered.",
        );
      }
      status.stop();
      active.delete(job.key);
      if (!stopping.aborted && (!executionCompleted || delivered))
        await store.setInFlight(job.key, undefined);
    }
  }

  // ── Requests ─────────────────────────────────────────────────────────────────────────────

  async function startRun(job: Job, message: ChatMessage, pendingJob: PendingJob) {
    const signal = AbortSignal.any([pendingJob.controller.signal, shutdown.signal]);
    signal.throwIfAborted();
    const report = (status: StatusText) => job.status.set(status);
    const space = spaceOf(message, options.shareChannels);
    const workspace = await cancellable(
      lock(`repo:${space}:${repoKey(job.repo)}`, () => workspaces.ensure(job.repo, report, space)),
      signal,
    );
    report(WORKING);
    const stored = store.session(job.key);
    // A session from a sandbox that has since been reset cannot be continued.
    const session = stored?.workspaceId === workspace.id ? stored : undefined;
    const history = message.inThread
      ? (await cancellable(adapter.history(job.thread, session?.lastMessageId), signal)).filter(
          (entry) =>
            entry.id !== message.id &&
            entry.id !== job.status.messageId &&
            (entry.fromBot || allowed(entry.author)) &&
            (!session || !entry.fromBot),
        )
      : [];
    const prompt = buildPrompt({
      platform: adapter.displayName,
      message,
      history,
      continued: Boolean(session),
    });
    const attachments = await attachmentsFor(prompt.images, signal);
    signal.throwIfAborted();
    const input = {
      workspace: workspace.id,
      deadlineAt: new Date(pendingJob.deadline!).toISOString(),
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
    const submission = gitterm.runs.create(input).catch(async (error: unknown) => {
      // The sandbox can pause again between waking it and submitting; wake it once more.
      if (!(error instanceof WorkspaceLifecycleError) || error.code !== "WORKSPACE_NOT_RUNNING") {
        throw error;
      }
      await gitterm.workspaces.ensureRunning(workspace.id);
      signal.throwIfAborted();
      return gitterm.runs.create(input);
    });
    // If cancellation wins while submission is in flight, cancel its late-created run too.
    void submission
      .then(async (created) => {
        if (signal.aborted) await gitterm.runs.cancel(created).catch(noop);
      })
      .catch(noop);
    const run = await cancellable(submission, signal);
    pendingJob.run = run;
    if (signal.aborted) {
      await gitterm.runs.cancel(run).catch(noop);
      signal.throwIfAborted();
    }
    await store.setSession(job.key, {
      repo: repoKey(job.repo),
      workspaceId: workspace.id,
      runId: run.id,
      lastMessageId: message.id,
    });
    return run;
  }

  async function handleRequest(message: ChatMessage, repo: Repo, pendingJob: PendingJob) {
    const key = threadKeyOf(message.thread);
    if (shutdown.signal.aborted) return;
    // Stopped while waiting behind the thread's earlier request.
    if (pendingJob.controller.signal.aborted) {
      await say(message.thread, describeFailure(null, { stoppedBy: pendingJob.stoppedBy }));
      await adapter.mark?.(message, "failed").catch(noop);
      return;
    }
    startClock(pendingJob);
    active.set(key, pendingJob);
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
      scope,
      thread: job.thread,
      ...(status.messageId ? { statusId: status.messageId } : {}),
      requester: job.requester,
      repo: repoKey(repo),
      sandbox: pendingJob.sandbox,
      deadline: pendingJob.deadline!,
    };
    await store.setInFlight(key, request);
    let run: AgentRun;
    try {
      run = await startRun(job, message, pendingJob);
    } catch (error) {
      log.error("Could not start an agent run", { thread: key }, error);
      if (pendingJob.run) await gitterm.runs.cancel(pendingJob.run).catch(noop);
      await status.finish(
        describeFailure(error, {
          stoppedBy: pendingJob.stoppedBy,
          timedOut: pendingJob.controller.signal.reason === "deadline",
        }),
      );
      status.stop();
      active.delete(key);
      await adapter.mark?.(message, "failed").catch(noop);
      await store.setInFlight(key, undefined);
      return;
    }
    try {
      await store.setInFlight(key, {
        ...request,
        run: { workspaceId: run.workspaceId, id: run.id },
      });
    } catch (error) {
      await gitterm.runs.cancel(run).catch(noop);
      status.stop();
      throw error;
    }
    log.info("Agent run started", {
      botId: options.botId,
      platform: adapter.platform,
      requesterId: message.author.id,
      workspaceId: run.workspaceId,
      runId: run.id,
      repo: repoKey(repo),
    });
    await follow(job, run, pendingJob);
  }

  const askForRepo = (thread: ChatThread) =>
    say(
      thread,
      `Which repository? Mention me again and name one of: ${knownRepos.map(repoLabel).join(", ")}.`,
    );

  async function command(name: string, message: ChatMessage, repo: Repo | undefined) {
    const key = threadKeyOf(message.thread);
    if (name === "stop") {
      const jobs = pending.get(key);
      const current = active.get(key);
      if (!jobs?.size && !current) return say(message.thread, "Nothing is running in this thread.");
      const stopping = new Set([...(jobs ?? []), ...(current ? [current] : [])]);
      for (const job of stopping) {
        job.stoppedBy = message.author;
        job.controller.abort("stopped");
      }
      await Promise.all(
        [...stopping].map((job) => (job.run ? gitterm.runs.cancel(job.run).catch(noop) : null)),
      );
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
      const space = spaceOf(message, options.shareChannels);
      const sandbox = `${space}:${repoKey(repo)}`;
      const jobs = [...pending.values()].flatMap((entries) => [...entries]);
      // Recovered runs from before sandbox keys were saved match by workspace instead.
      const current = jobs.some((job) => !job.sandbox && job.run)
        ? await workspaces.find(repo, space)
        : null;
      if (
        jobs.some(
          (job) =>
            job.sandbox === sandbox || (current !== null && job.run?.workspaceId === current.id),
        )
      ) {
        return say(message.thread, "Stop or finish the work in this sandbox before resetting it.");
      }
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
    const workspace = await workspaces.find(repo, spaceOf(message, options.shareChannels));
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
    if (shutdown.signal.aborted) return;
    const key = threadKeyOf(message.thread);
    if (!servesChannel(message.thread.channel) || !fresh(`${key}:${message.id}`)) return;
    if (!allowed(message.author)) {
      if (answerTyped(key, message)) return;
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
    const all = [...pending.values()].flatMap((jobs) => [...jobs]);
    if (
      all.length >= (options.maxPendingRequests ?? 20) ||
      all.filter((job) => job.requester.id === message.author.id).length >=
        (options.maxPendingPerUser ?? 3)
    ) {
      void say(
        message.thread,
        "The request queue is full. Please try again after existing work finishes.",
      );
      return;
    }
    const pendingJob: PendingJob = {
      controller: new AbortController(),
      requester: message.author,
      sandbox: `${spaceOf(message, options.shareChannels)}:${repoKey(repo)}`,
    };
    if (!pending.has(key)) pending.set(key, new Set());
    pending.get(key)!.add(pendingJob);
    // Threads run concurrently in the sandbox; messages within one thread wait their turn.
    trackTask(
      lock(key, () => handleRequest(message, repo, pendingJob))
        .catch((error: unknown) => log.error("Request failed", { thread: key }, error))
        .finally(() => {
          if (active.get(key) === pendingJob) active.delete(key);
          clearTimeout(pendingJob.timer);
          pending.get(key)?.delete(pendingJob);
          if (!pending.get(key)?.size) pending.delete(key);
        }),
    );
  }

  /** Requests a previous process left behind: reattach to their runs, or say they were lost. */
  async function recover() {
    for (const [key, request] of Object.entries(store.inFlight())) {
      if (request.scope && request.scope !== scope) {
        // Left by a different workspace or server; its thread can't be reached from here.
        log.warn("Dropping a request from a different platform installation", {
          runId: request.run?.id,
        });
        await store.setInFlight(key, undefined);
        continue;
      }
      if (
        !allowed(request.requester) ||
        !servesChannel(request.thread.channel) ||
        !knownRepos.some((repo) => repoKey(repo) === request.repo)
      ) {
        if (request.run) await gitterm.runs.cancel(request.run).catch(noop);
        await store.setInFlight(key, undefined);
        continue;
      }
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
      // Counted like any queued request, so reset and the queue limits see it.
      const pendingJob: PendingJob = {
        controller: new AbortController(),
        requester: request.requester,
        sandbox: request.sandbox ?? "",
        run: request.run,
      };
      if (!pending.has(key)) pending.set(key, new Set());
      pending.get(key)!.add(pendingJob);
      trackTask(
        lock(key, async () => {
          startClock(pendingJob, request.deadline);
          let snapshot: AgentRun;
          try {
            // Output lives in the workspace. Wake it before reading terminal results.
            await gitterm.workspaces.ensureRunning(request.run!.workspaceId, {
              signal: shutdown.signal,
            });
            snapshot = await gitterm.runs.get(request.run!);
          } catch (error) {
            clearTimeout(pendingJob.timer);
            if (shutdown.signal.aborted) return;
            // E.g. the sandbox was terminated: say so and free the thread.
            log.error("Reattaching failed", { thread: key }, error);
            await job.status.finish(describeFailure(error));
            job.status.stop();
            await store.setInFlight(key, undefined);
            return;
          }
          await follow(
            job,
            request.run as RunRef,
            pendingJob,
            snapshot.status === "completed" ? snapshot : undefined,
          );
        })
          .catch((error: unknown) => log.error("Reattaching failed", { thread: key }, error))
          .finally(() => {
            if (active.get(key) === pendingJob) active.delete(key);
            clearTimeout(pendingJob.timer);
            pending.get(key)?.delete(pendingJob);
            if (!pending.get(key)?.size) pending.delete(key);
          }),
      );
    }
  }

  /**
   * One process per saved bot. A restart waits out the previous process's claim (it expires
   * 90 s after its last renewal); losing the claim later stops this process with exit code 1,
   * so a supervisor restarts it.
   */
  async function claimLease(id: string) {
    for (let waited = 0; ; waited += 5_000) {
      try {
        await gitterm.bots.acquireLease(id);
        return;
      } catch (error) {
        if (!(error instanceof GittermError && error.code === "CONFLICT") || waited >= 100_000)
          throw error;
        if (waited === 0)
          log.warn(
            "Another process is running this bot, or one stopped without calling bot.stop() and holds it for up to 90 s; waiting…",
          );
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }

  const workspaceManager = () =>
    createWorkspaceManager({
      gitterm,
      platform: adapter.platform,
      scope,
      botId: options.botId,
      directRetentionMs: options.directRetentionMs,
      identityPolicy: {
        allowedUsers: options.allowedUsers,
        allowGuests: options.allowGuests,
        allowedChannels: options.allowedChannels,
        shareChannels: options.shareChannels,
      },
      connections: options.connections ?? [],
      env: options.env ?? {},
      setup: options.setup ?? [],
      model,
      instructions: agentInstructions(adapter.displayName, options.instructions),
      overrides: options.workspace,
      log,
    });

  /**
   * Applies settings saved in the dashboard since they were loaded, checked like at start. New
   * requests use them; runs in progress keep theirs. Never throws: on failure the bot carries on
   * with what it has.
   */
  async function reload() {
    const local = options.localOptions;
    if (!local) return;
    try {
      const saved = await gitterm.bots.self();
      if (!saved) return;
      savedAt = saved.updatedAt;
      if (saved.platform !== adapter.platform) {
        log.warn(`"${saved.name}" is now a ${saved.platform} bot; run it on that platform.`);
        return;
      }
      const next = settingsFor({
        ...applySavedConfig(local, saved, log),
        adapter,
        localOptions: local,
      });
      await checkSetup({
        gitterm,
        repos: next.knownRepos,
        connections: next.options.connections ?? [],
        model: next.model,
        overrides: next.options.workspace,
        log,
      });
      ({ options, defaultRepo, extraRepos, channelRepos, knownRepos, allowedUsers, model } = next);
      workspaces = workspaceManager();
      log.info(
        `Applied the settings saved for "${saved.name}". New sandboxes use them; reset replaces an existing one.`,
      );
    } catch (error) {
      log.warn(
        "Could not apply the newly saved settings; keeping the current ones. Save again in GitTerm to retry.",
        error,
      );
    }
  }

  const bot: Bot = {
    async start() {
      if (running) throw new Error("The bot is already started");
      running = true;
      shutdown = new AbortController();
      try {
        store = await openStateStore(
          resolvePath(options.stateFile ?? `.gitterm-bot/${adapter.platform}.json`),
        );
        const savedIdentity = gitterm.bots ? await gitterm.bots.self() : null;
        if (savedIdentity && savedIdentity.id !== options.botId) {
          throw new Error(
            "Load the saved configuration with withSavedConfig() before starting a saved bot",
          );
        }
        if (savedIdentity) {
          savedAt = savedIdentity.updatedAt;
          const id = randomUUID();
          await claimLease(id);
          leaseId = id;
          let failures = 0;
          let renewing = false;
          leaseTimer = setInterval(() => {
            if (renewing || shutdown.signal.aborted) return;
            renewing = true;
            void gitterm.bots
              .acquireLease(id)
              .then(async (lease) => {
                failures = 0;
                if (lease.updatedAt && lease.updatedAt !== savedAt) await reload();
              })
              .catch((error: unknown) => {
                // A blip is fine (the claim lasts 90 s); losing it to another process is not.
                const lost = error instanceof GittermError && error.code === "CONFLICT";
                if (!lost && ++failures < 2) return;
                log.error("Lost this bot's runtime claim; stopping", error);
                process.exitCode = 1;
                void bot.stop().catch(noop);
              })
              .finally(() => (renewing = false));
          }, 30_000);
        }
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
            if (
              !canAnswer(open.prompt, by) ||
              (answer.kind === "permission" && answer.response === "always" && !options.allowAlways)
            )
              return "forbidden";
            open.finish({ answer, by });
            return "answered";
          },
          prompt: (promptId) => prompts.get(promptId)?.prompt,
          canAnswer(promptId, by) {
            const open = prompts.get(promptId);
            return Boolean(open && canAnswer(open.prompt, by));
          },
          accepts: servesChannel,
        });
        scope = started.scope;
        workspaces = workspaceManager();
        // Recovered runs take their threads' locks first, so new messages queue behind them.
        await recover();
        markReady();
        log.info(
          `GitTerm ${adapter.displayName} bot is running for ${knownRepos.map(repoLabel).join(", ")}.`,
        );
      } catch (error) {
        await bot.stop();
        throw error;
      }
    },
    // Runs keep going in GitTerm and stay in the state file; the next start reattaches to them
    // and asks open questions again.
    async stop() {
      if (!running) return;
      running = false;
      shutdown.abort();
      if (leaseTimer) clearInterval(leaseTimer);
      leaseTimer = undefined;
      await adapter.stop().catch(noop);
      await Promise.allSettled(tasks);
      if (leaseId) await gitterm.bots.releaseLease(leaseId).catch(noop);
      leaseId = undefined;
    },
  };
  return bot;
}
