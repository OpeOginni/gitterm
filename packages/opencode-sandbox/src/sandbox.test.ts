import { expect, mock, test } from "bun:test";

const created: { publicPreviews?: boolean }[] = [];
let jobStatus = "running";
let saved: unknown[] = [];
let pushes = false;
let pushed: ((event: { sandboxId: string; jobId: string }) => void) | undefined;
let failRead: { code: string; message: string } | undefined;
const jobView = (status: string) => ({
  job: { id: "job1", command: "bun run build", cwd: "/w", snapshotId: null, timeoutMs: 60_000 },
  state: {
    status,
    exitCode: status === "running" ? null : 1,
    startedAt: null,
    finishedAt: null,
    processAlive: status === "running",
  },
  log: { offset: 0, nextOffset: 5, totalBytes: 5, truncated: false, text: "boom\n" },
});
let previews = "either";
const actual = await import("@gitterm/sdk/sandbox");
mock.module("@gitterm/sdk/sandbox", () => ({
  ...actual,
  createSandboxBackend: () => ({}),
  createSandboxClient: () => ({
    identity: { mode: "direct", account: "e2b", provider: "e2b" },
    limits: { defaultLifetimeMinutes: 30, maxSandboxes: 2 },
    get capabilities() {
      return { previews };
    },
    list: async () => [],
    store: { list: async () => saved },
    get onJobFinished() {
      return pushes
        ? (listener: (event: { sandboxId: string; jobId: string }) => void) => {
            pushed = listener;
            return () => (pushed = undefined);
          }
        : undefined;
    },
    exec: async () => jobView("running"),
    job: async () => {
      if (failRead) throw Object.assign(new Error(failRead.message), { code: failRead.code });
      return jobView(jobStatus);
    },
    create: async (input: { publicPreviews?: boolean }) => {
      created.push(input);
      return {
        id: "sbx",
        name: "s",
        state: "running",
        mode: "direct",
        account: "e2b",
        provider: "e2b",
        sessionId: "ses",
        createdAt: new Date().toISOString(),
        expiresAt: null,
        snapshot: null,
        jobs: {},
        previews: {},
      };
    },
  }),
}));
const { registerSandboxTools } = await import("./sandbox");

async function createSandbox(options: Record<string, unknown>, input: Record<string, unknown>) {
  const asked: string[] = [];
  let create: ((input: unknown, context: unknown) => Promise<unknown>) | undefined;
  const ctx = {
    tool: {
      transform: async (transform: (editor: unknown) => void) =>
        transform({
          namespace: () => {},
          add: (tool: { name: string; execute: typeof create }) => {
            if (tool.name === "sandbox_create") create = tool.execute;
          },
        }),
    },
    session: { get: async () => ({ location: { directory: process.cwd() } }) },
    permission: { assert: async (request: { action: string }) => asked.push(request.action) },
  };
  const settings = {
    account: "e2b",
    accounts: { e2b: { mode: "direct", provider: "e2b", apiKey: "k" } },
    ...options,
  };
  await registerSandboxTools(ctx as never, settings as never);
  created.length = 0;
  await create!(input, { sessionID: "ses", agent: "a", messageID: "m", id: "t" });
  return { asked, publicPreviews: created[0]?.publicPreviews };
}

test("publicPreviews in the options makes every sandbox public without asking", async () => {
  expect(await createSandbox({ publicPreviews: true }, {})).toEqual({
    asked: ["gitterm.sandbox.provision"],
    publicPreviews: true,
  });
});

test("without the option, previews are private unless the agent asks and you approve", async () => {
  expect(await createSandbox({}, {})).toEqual({
    asked: ["gitterm.sandbox.provision"],
    publicPreviews: false,
  });
  expect(await createSandbox({}, { publicPreviews: true })).toEqual({
    asked: ["gitterm.sandbox.provision", "gitterm.sandbox.public"],
    publicPreviews: true,
  });
});

test("where previews are always private, nothing is asked and nothing is made public", async () => {
  previews = "private";
  try {
    expect(await createSandbox({}, { publicPreviews: true })).toEqual({
      asked: ["gitterm.sandbox.provision"],
      publicPreviews: false,
    });
  } finally {
    previews = "either";
  }
});

async function tools() {
  const added = new Map<string, (input: unknown, context: unknown) => Promise<any>>();
  const posted: Record<string, any>[] = [];
  const ctx = {
    tool: {
      transform: async (transform: (editor: unknown) => void) =>
        transform({
          namespace: () => {},
          add: (tool: {
            name: string;
            execute: (input: unknown, context: unknown) => Promise<any>;
          }) => added.set(tool.name, tool.execute),
        }),
    },
    session: {
      get: async () => ({ location: { directory: process.cwd() } }),
      synthetic: async (input: Record<string, any>) => posted.push(input),
    },
    permission: { assert: async () => {} },
  };
  const settings = {
    account: "e2b",
    accounts: { e2b: { mode: "direct", provider: "e2b", apiKey: "k" } },
  };
  const unload = await registerSandboxTools(ctx as never, settings as never, 10);
  const call = (name: string, input: unknown) =>
    added.get(name)!(input, { sessionID: "ses", agent: "a", messageID: "m", id: "t" });
  return { call, posted, unload };
}

test("a job left running posts one message to the session when it finishes", async () => {
  jobStatus = "running";
  const { call, posted, unload } = await tools();
  const result = await call("sandbox_exec", {
    sandboxId: "sbx",
    command: "bun run build",
    background: true,
  });
  expect(result.output).toMatchObject({ sandboxId: "sbx", jobId: "job1", status: "running" });
  expect(result.content).toContain("A message will arrive when it finishes");
  await Bun.sleep(40);
  expect(posted).toHaveLength(0);
  jobStatus = "failed";
  await Bun.sleep(40);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    sessionID: "ses",
    description: "Sandbox job failed (exit 1): bun run build",
    metadata: { source: "gitterm.sandbox", sandboxId: "sbx", jobId: "job1", state: "failed" },
  });
  expect(posted[0]!.text).toStartWith('<sandbox-job id="job1" sandbox="sbx" state="failed">');
  expect(posted[0]!.text).toContain('untrusted="true"');
  await Bun.sleep(40);
  expect(posted).toHaveLength(1);
  await unload();
});

test("no message when sandbox_job already saw the job finish", async () => {
  jobStatus = "running";
  const { call, posted, unload } = await tools();
  await call("sandbox_exec", { sandboxId: "sbx", command: "bun run build", background: true });
  jobStatus = "succeeded";
  const seen = await call("sandbox_job", { sandboxId: "sbx", jobId: "job1" });
  expect(seen.output.status).toBe("succeeded");
  await Bun.sleep(60);
  expect(posted).toHaveLength(0);
  await unload();
});

const record = (jobs: Record<string, unknown>, servers: Record<string, unknown> = {}) => ({
  id: "sbx",
  mode: "direct",
  account: "e2b",
  provider: "e2b",
  state: "running",
  sessionId: "ses_creator",
  jobs,
  previews: servers,
});

test("after a reload, a job saved as running still gets its message", async () => {
  jobStatus = "running";
  saved = [
    record(
      {
        job1: { id: "job1", status: "running" },
        job2: { id: "job2", status: "running", sessionId: "ses_other" },
        server: { id: "server", status: "running" },
      },
      { "3000": { port: 3000, jobId: "server", url: "", public: false } },
    ),
    { ...record({ old: { id: "old", status: "running" } }), state: "terminated" },
  ];
  try {
    const { posted, unload } = await tools();
    jobStatus = "failed";
    await Bun.sleep(60);
    expect(posted.map((message) => [message.sessionID, message.metadata.jobId])).toEqual([
      ["ses_creator", "job1"],
      ["ses_other", "job2"],
    ]);
    await unload();
  } finally {
    saved = [];
  }
});

test("a slow sandbox doesn't lose the job; a vanished one is reported", async () => {
  jobStatus = "running";
  const { call, posted, unload } = await tools();
  await call("sandbox_exec", { sandboxId: "sbx", command: "bun run build", background: true });
  failRead = { code: "timeout", message: "E2B timed out while trying to run a command." };
  await Bun.sleep(300);
  expect(posted).toHaveLength(0);
  failRead = undefined;
  jobStatus = "succeeded";
  for (let i = 0; i < 40 && posted.length === 0; i++) await Bun.sleep(50);
  expect(posted.map((message) => message.metadata.state)).toEqual(["succeeded"]);
  await unload();

  jobStatus = "running";
  const second = await tools();
  await second.call("sandbox_exec", {
    sandboxId: "sbx",
    command: "bun run build",
    background: true,
  });
  failRead = { code: "not_found", message: "The sandbox no longer exists." };
  for (let i = 0; i < 40 && second.posted.length === 0; i++) await Bun.sleep(50);
  expect(second.posted.map((message) => message.metadata.state)).toEqual(["unknown"]);
  failRead = undefined;
  await second.unload();
});

test("where the account pushes job completions, the event sends the message at once", async () => {
  pushes = true;
  jobStatus = "running";
  try {
    const { call, posted, unload } = await tools();
    await call("sandbox_exec", { sandboxId: "sbx", command: "bun run build", background: true });
    jobStatus = "succeeded";
    // Polling is down to once a minute here, so only the push can deliver this quickly.
    await Bun.sleep(100);
    expect(posted).toHaveLength(0);
    pushed!({ sandboxId: "sbx", jobId: "job1" });
    for (let i = 0; i < 20 && posted.length === 0; i++) await Bun.sleep(25);
    expect(posted.map((message) => message.metadata.state)).toEqual(["succeeded"]);
    await unload();
    expect(pushed).toBeUndefined();
  } finally {
    pushes = false;
  }
});
