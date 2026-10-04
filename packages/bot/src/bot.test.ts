import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentRun,
  AgentRunEvent,
  AgentRunReply,
  Connection,
  GittermClient,
  Workspace,
} from "@gitterm/sdk";
import { createBot } from "./bot.js";
import type {
  ChatAdapter,
  ChatEvents,
  ChatMessage,
  ChatPrompt,
  ChatThread,
  HistoryMessage,
} from "./types.js";

const quiet = { info() {}, warn() {}, error() {} };
const thread: ChatThread = { channel: "C1", thread: "100" };
const alice = { id: "U1", name: "Alice" };

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(condition: () => boolean, label = "condition") {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** A push-driven async iterable standing in for the run event stream. */
function stream<T>() {
  const queue: T[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  return {
    push(item: T) {
      queue.push(item);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (queue.length === 0 && closed) return;
        if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
        const item = queue.shift();
        if (item !== undefined) yield item;
      }
    },
  };
}

function run(id: string, status: AgentRun["status"], extra: Partial<AgentRun> = {}): AgentRun {
  return {
    id,
    workspaceId: "ws1",
    title: "",
    status,
    error: null,
    finalText: null,
    pendingInputs: [],
    context: { type: "isolated" },
    createdAt: new Date().toISOString(),
    submittedAt: null,
    completedAt: null,
    ...extra,
  };
}

function fakeGitterm(options: { workspaces?: Workspace[]; connections?: Connection[] } = {}) {
  const workspaces = [...(options.workspaces ?? [])];
  const streams = new Map<string, ReturnType<typeof stream<AgentRunEvent>>>();
  const calls = {
    created: [] as Array<Record<string, unknown>>,
    runs: [] as Array<Record<string, unknown>>,
    responses: [] as Array<{ requestId: string; reply: AgentRunReply }>,
    cancelled: [] as string[],
    ensured: [] as string[],
  };
  const streamFor = (id: string) => {
    if (!streams.has(id)) streams.set(id, stream<AgentRunEvent>());
    return streams.get(id)!;
  };
  const client = {
    workspaces: {
      list: async ({ metadata }: { metadata: Record<string, string> }) => ({
        workspaces: workspaces.filter((workspace) =>
          Object.entries(metadata).every(([key, value]) => workspace.metadata?.[key] === value),
        ),
        pagination: { total: 0, limit: 1, offset: 0, hasMore: false },
      }),
      create: async (input: Record<string, unknown>) => {
        calls.created.push(input);
        const workspace = {
          id: "ws1",
          status: "pending",
          metadata: input.metadata,
        } as unknown as Workspace;
        workspaces.push(workspace);
        return { workspace };
      },
      ensureRunning: async (id: string) => {
        calls.ensured.push(id);
        const workspace = workspaces.find((entry) => entry.id === id)!;
        (workspace as { status: string }).status = "running";
        return { workspace, runtime: {} };
      },
      terminate: async () => ({ workspace: null, cleanupInBackground: false }),
    },
    integrations: { connections: { list: async () => options.connections ?? [] } },
    runs: {
      create: async (input: Record<string, unknown>) => {
        calls.runs.push(input);
        return run(`run${calls.runs.length}`, "pending");
      },
      events: (ref: { id: string }) => streamFor(ref.id),
      respond: async (_ref: unknown, input: { requestId: string; reply: AgentRunReply }) => {
        calls.responses.push(input);
        return run("x", "running");
      },
      cancel: async (ref: { id: string }) => {
        calls.cancelled.push(ref.id);
        streamFor(ref.id).push({ type: "run.cancelled", run: run(ref.id, "cancelled") });
        return { cancelled: true };
      },
    },
  };
  return { client: client as unknown as GittermClient, calls, stream: streamFor };
}

function fakeAdapter(history: HistoryMessage[] = [], indicator?: boolean) {
  let events!: ChatEvents;
  const log = {
    posts: [] as string[],
    edits: new Map<string, string>(),
    removed: [] as string[],
    replies: [] as Array<{ markdown: string; footer: string }>,
    prompts: [] as ChatPrompt[],
    settled: [] as string[],
    indicators: [] as string[],
  };
  const adapter: ChatAdapter = {
    platform: "test",
    displayName: "Test",
    async start(e) {
      events = e;
      return { scope: "T1" };
    },
    async stop() {},
    async history() {
      return history;
    },
    async post(_thread, text) {
      log.posts.push(text);
      return `s${log.posts.length}`;
    },
    async edit(_thread, id, text) {
      log.edits.set(id, text);
    },
    async remove(_thread, id) {
      log.removed.push(id);
    },
    async reply(_thread, markdown, footer) {
      log.replies.push({ markdown, footer });
    },
    async ask(_thread, prompt) {
      log.prompts.push(prompt);
      return `p${log.prompts.length}`;
    },
    async settle(_thread, _id, _prompt, outcome) {
      log.settled.push(outcome);
    },
    ...(indicator === undefined
      ? {}
      : {
          async indicate(_thread: ChatThread, status: string) {
            log.indicators.push(status);
            return indicator;
          },
        }),
  };
  const send = (message: Partial<ChatMessage> & { id: string; text: string }) =>
    events.message({
      thread,
      author: alice,
      files: [],
      mentioned: true,
      inThread: false,
      ...message,
    });
  return { adapter, log, send, events: () => events };
}

const dirs: string[] = [];
async function stateFile() {
  const dir = await mkdtemp(join(tmpdir(), "gitterm-bot-"));
  dirs.push(dir);
  return join(dir, "state.json");
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const github = {
  id: "gh1",
  integration: "github",
  kind: "personal",
  name: "acme",
  status: "connected",
  connectedAt: "",
  details: { integration: "github", mode: "app", accountLogin: "Acme" },
} as Connection;
const docs = {
  id: "mcp1",
  integration: "mcp",
  kind: "personal",
  name: "Docs",
  status: "connected",
  connectedAt: "",
  details: { integration: "mcp" },
} as unknown as Connection;
const broken = { ...docs, id: "mcp2", status: "error" } as Connection;

describe("createBot", () => {
  test("creates a tagged sandbox, runs the request, and replies", async () => {
    const gitterm = fakeGitterm({ connections: [github, docs, broken] });
    const chat = fakeAdapter();
    const bot = createBot({
      adapter: chat.adapter,
      gitterm: gitterm.client,
      repo: "https://github.com/acme/app#main",
      stateFile: await stateFile(),
      logger: quiet,
    });
    await bot.start();
    chat.send({ id: "100", text: "fix the login bug" });
    await until(() => gitterm.calls.runs.length === 1, "run");

    expect(gitterm.calls.created[0]).toMatchObject({
      repo: "https://github.com/acme/app",
      branch: "main",
      agent: "opencode",
      metadata: {
        "gitterm-bot": "test:T1",
        "gitterm-bot-repo": "https://github.com/acme/app#main",
      },
      connections: ["gh1", "mcp1"],
    });
    expect(gitterm.calls.runs[0]).toMatchObject({
      workspace: "ws1",
      idempotencyKey: "test:T1:C1:100:100",
    });
    expect(gitterm.calls.runs[0]?.prompt).toContain("Request: fix the login bug");
    expect(gitterm.calls.runs[0]?.context).toBeUndefined();

    gitterm.stream("run1").push({
      type: "run.completed",
      run: run("run1", "completed", { finalText: "Opened #12" }),
    });
    await until(() => chat.log.replies.length === 1, "reply");
    expect(chat.log.replies[0]?.markdown).toBe("Opened #12");
    expect(chat.log.replies[0]?.footer).toContain("acme/app");
    await until(() => chat.log.removed.includes("s1"), "status removal");
  });

  test("continues the thread's session with only the messages it has not seen", async () => {
    const gitterm = fakeGitterm();
    const history: HistoryMessage[] = [
      { id: "101", author: { id: "B", name: "assistant" }, fromBot: true, text: "Done", files: [] },
      {
        id: "102",
        author: { id: "U2", name: "Bob" },
        fromBot: false,
        text: "also the logout",
        files: [],
      },
    ];
    const chat = fakeAdapter(history);
    const bot = createBot({
      adapter: chat.adapter,
      gitterm: gitterm.client,
      repo: "https://github.com/acme/app",
      stateFile: await stateFile(),
      logger: quiet,
    });
    await bot.start();
    chat.send({ id: "100", text: "fix login" });
    await until(() => gitterm.calls.runs.length === 1);
    gitterm.stream("run1").push({ type: "run.completed", run: run("run1", "completed") });
    await until(() => chat.log.replies.length === 1);

    chat.send({ id: "103", text: "and that too", inThread: true });
    await until(() => gitterm.calls.runs.length === 2, "second run");
    const second = gitterm.calls.runs[1]!;
    expect(second.context).toEqual({ type: "continue", run: { workspaceId: "ws1", id: "run1" } });
    expect(second.prompt).toContain("Bob: also the logout");
    expect(second.prompt).not.toContain("assistant: Done");
  });

  test("relays a question and answers it from a typed reply", async () => {
    const gitterm = fakeGitterm();
    const chat = fakeAdapter();
    const bot = createBot({
      adapter: chat.adapter,
      gitterm: gitterm.client,
      repo: "https://github.com/acme/app",
      stateFile: await stateFile(),
      logger: quiet,
    });
    await bot.start();
    chat.send({ id: "100", text: "pick a db" });
    await until(() => gitterm.calls.runs.length === 1);

    const request = {
      id: "q1",
      kind: "question" as const,
      createdAt: null,
      toolCallId: null,
      questions: [
        {
          key: "db",
          header: "Database",
          question: "Which one?",
          options: [
            { label: "Postgres", description: "" },
            { label: "SQLite", description: "" },
          ],
          multiple: false,
          custom: false,
        },
      ],
    };
    gitterm.stream("run1").push({
      type: "input.required",
      run: run("run1", "awaiting_input"),
      request,
    });
    await until(() => chat.log.prompts.length === 1, "prompt");

    // Someone else chatting in the thread does not answer the requester's question.
    chat.send({ id: "101", text: "1", mentioned: false, author: { id: "U2", name: "Bob" } });
    chat.send({ id: "102", text: "2", mentioned: false, inThread: true });
    await until(() => gitterm.calls.responses.length === 1, "response");
    expect(gitterm.calls.responses[0]).toEqual({
      requestId: "q1",
      reply: { type: "question", answers: { db: ["SQLite"] } },
    });
    expect(chat.log.settled[0]).toBe("Alice: SQLite");
  });

  test("answers a permission prompt from a button", async () => {
    const gitterm = fakeGitterm();
    const chat = fakeAdapter();
    const bot = createBot({
      adapter: chat.adapter,
      gitterm: gitterm.client,
      repo: "https://github.com/acme/app",
      stateFile: await stateFile(),
      logger: quiet,
    });
    await bot.start();
    chat.send({ id: "100", text: "clean up" });
    await until(() => gitterm.calls.runs.length === 1);
    gitterm.stream("run1").push({
      type: "input.required",
      run: run("run1", "awaiting_input"),
      request: {
        id: "perm1",
        kind: "permission",
        createdAt: null,
        toolCallId: null,
        permission: "bash",
        patterns: ["rm -rf dist"],
        always: [],
        title: "bash: rm -rf dist",
      },
    });
    await until(() => chat.log.prompts.length === 1);
    const prompt = chat.log.prompts[0]!;
    expect(chat.events().answer(prompt.id, { kind: "question", labels: ["x"] }, alice)).toBe(false);
    expect(chat.events().answer(prompt.id, { kind: "permission", response: "always" }, alice)).toBe(
      true,
    );
    await until(() => gitterm.calls.responses.length === 1);
    expect(gitterm.calls.responses[0]?.reply).toEqual({ type: "permission", response: "always" });
    expect(chat.events().answer(prompt.id, { kind: "permission", response: "once" }, alice)).toBe(
      false,
    );
  });

  test("stop cancels the thread's run and closes its open prompt", async () => {
    const gitterm = fakeGitterm();
    const chat = fakeAdapter();
    const bot = createBot({
      adapter: chat.adapter,
      gitterm: gitterm.client,
      repo: "https://github.com/acme/app",
      stateFile: await stateFile(),
      logger: quiet,
    });
    await bot.start();
    chat.send({ id: "100", text: "long task" });
    await until(() => gitterm.calls.runs.length === 1);
    gitterm.stream("run1").push({
      type: "input.required",
      run: run("run1", "awaiting_input"),
      request: {
        id: "perm1",
        kind: "permission",
        createdAt: null,
        toolCallId: null,
        permission: "bash",
        patterns: [],
        always: [],
        title: "bash: ls",
      },
    });
    await until(() => chat.log.prompts.length === 1);

    chat.send({ id: "101", text: "stop", inThread: true });
    await until(() => chat.log.edits.get("s1") === "Stopped by Alice.", "stopped status");
    expect(gitterm.calls.cancelled).toEqual(["run1"]);
    expect(chat.log.settled).toEqual(["The run ended before anyone answered."]);
    expect(gitterm.calls.responses).toEqual([]);
  });

  test("wakes a paused sandbox instead of creating another", async () => {
    const paused = {
      id: "ws1",
      status: "paused",
      metadata: {
        "gitterm-bot": "test:T1",
        "gitterm-bot-repo": "https://github.com/acme/app",
      },
    } as unknown as Workspace;
    const gitterm = fakeGitterm({ workspaces: [paused] });
    const chat = fakeAdapter();
    const bot = createBot({
      adapter: chat.adapter,
      gitterm: gitterm.client,
      repo: "https://github.com/acme/app",
      stateFile: await stateFile(),
      logger: quiet,
    });
    await bot.start();
    chat.send({ id: "100", text: "hello" });
    await until(() => gitterm.calls.runs.length === 1);
    expect(gitterm.calls.created).toEqual([]);
    expect(gitterm.calls.ensured).toEqual(["ws1"]);
  });

  test("reattaches to runs that were in flight when the bot stopped", async () => {
    const file = await stateFile();
    await writeFile(
      file,
      JSON.stringify({
        sessions: {},
        inFlight: {
          "C1:100": {
            thread,
            statusId: "s9",
            requester: alice,
            repo: "https://github.com/acme/app",
            run: { workspaceId: "ws1", id: "run7" },
          },
          "C1:200": {
            thread: { channel: "C1", thread: "200" },
            statusId: "s8",
            requester: alice,
            repo: "https://github.com/acme/app",
          },
        },
      }),
    );
    const gitterm = fakeGitterm();
    const chat = fakeAdapter();
    const bot = createBot({
      adapter: chat.adapter,
      gitterm: gitterm.client,
      repo: "https://github.com/acme/app",
      stateFile: file,
      logger: quiet,
    });
    await bot.start();
    expect(chat.log.edits.get("s8")).toContain("restarted");
    gitterm.stream("run7").push({
      type: "run.completed",
      run: run("run7", "completed", { finalText: "All done" }),
    });
    await until(() => chat.log.replies.length === 1, "recovered reply");
    expect(chat.log.replies[0]?.markdown).toBe("All done");
  });

  test("ignores channels without a repository", async () => {
    const gitterm = fakeGitterm();
    const chat = fakeAdapter();
    const bot = createBot({
      adapter: chat.adapter,
      gitterm: gitterm.client,
      channels: { C2: "https://github.com/acme/api" },
      stateFile: await stateFile(),
      logger: quiet,
    });
    await bot.start();
    expect(chat.events().accepts("C1")).toBe(false);
    expect(chat.events().accepts("C2")).toBe(true);
    chat.send({ id: "100", text: "hello" });
    await tick();
    expect(chat.log.posts).toEqual([]);
  });

  test("uses the native indicator instead of a status message when the platform has one", async () => {
    const gitterm = fakeGitterm();
    const chat = fakeAdapter([], true);
    const bot = createBot({
      adapter: chat.adapter,
      gitterm: gitterm.client,
      repo: "https://github.com/acme/app",
      stateFile: await stateFile(),
      logger: quiet,
    });
    await bot.start();
    chat.send({ id: "100", text: "pick one" });
    await until(() => gitterm.calls.runs.length === 1);
    gitterm.stream("run1").push({
      type: "input.required",
      run: run("run1", "awaiting_input"),
      request: {
        id: "perm1",
        kind: "permission",
        createdAt: null,
        toolCallId: null,
        permission: "bash",
        patterns: [],
        always: [],
        title: "bash: ls",
      },
    });
    await until(() => chat.log.prompts.length === 1);
    chat.events().answer(chat.log.prompts[0]!.id, { kind: "permission", response: "once" }, alice);
    await until(() => gitterm.calls.responses.length === 1);
    gitterm.stream("run1").push({
      type: "run.completed",
      run: run("run1", "completed", { finalText: "Done" }),
    });
    await until(() => chat.log.replies.length === 1);
    await until(() => chat.log.indicators.at(-1) === "", "indicator cleared");

    expect(chat.log.posts).toEqual([]);
    expect(chat.log.indicators).toEqual([
      "is working on it…",
      "is creating a sandbox for acme/app (the first start takes a few minutes)…",
      "is working on it…",
      "", // hidden while the approval prompt waits
      "is working on it…",
      "", // cleared once the answer is posted
    ]);
  });

  test("falls back to a status message when the platform refuses the indicator", async () => {
    const gitterm = fakeGitterm();
    const chat = fakeAdapter([], false);
    const bot = createBot({
      adapter: chat.adapter,
      gitterm: gitterm.client,
      repo: "https://github.com/acme/app",
      stateFile: await stateFile(),
      logger: quiet,
    });
    await bot.start();
    chat.send({ id: "100", text: "hello" });
    await until(() => gitterm.calls.runs.length === 1);
    expect(chat.log.posts[0]).toBe("Working on it…");
    gitterm.stream("run1").push({
      type: "run.failed",
      run: run("run1", "failed", { error: "model unavailable" }),
    });
    await until(() => chat.log.edits.get("s1")?.includes("model unavailable") === true);
  });
});
