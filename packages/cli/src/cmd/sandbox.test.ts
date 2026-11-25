import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setProjectFeatures } from "@gitterm/sdk";

let state = { status: "failed", exitCode: 7 as number | null };
/** Client calls that start or resume compute, and pauses. */
const woke: string[] = [];
const view = () => ({
  job: { id: "job_1", snapshotId: null },
  state: {
    status: "succeeded",
    exitCode: 0,
    startedAt: null,
    finishedAt: null,
    processAlive: false,
  },
  log: { text: "", offset: 0, nextOffset: 0, totalBytes: 0 },
});
const actual = await import("@gitterm/sdk/sandbox");
const captures: Parameters<typeof actual.captureSource>[1][] = [];
const execs: {
  command: string;
  env?: Record<string, string>;
  waitMs?: number;
  sessionId?: string;
}[] = [];
mock.module("@gitterm/sdk/sandbox", () => ({
  ...actual,
  captureSource: async (directory: string, options: Parameters<typeof actual.captureSource>[1]) => {
    captures.push(options);
    return {
      snapshot: { id: "snap_1", digest: "digest", root: directory },
      archive: Buffer.alloc(0),
    };
  },
  // The provider rejects the key "bad-key" when setup checks it. Setup must not list: listing
  // deletes expired paused sandboxes.
  createSandboxBackend: (account: { ownKey: boolean; config: { apiKey?: string } }) => ({
    check: async () => {
      if (account.ownKey && account.config.apiKey === "bad-key")
        throw new Error("E2B rejected the key");
    },
    list: async () => {
      throw new Error("setup listed the account's sandboxes");
    },
  }),
  createSandboxClient: () => ({
    identity: { mode: "direct", account: "e2b", provider: "e2b" },
    capabilities: { previews: "either" },
    create: async () => (woke.push("create"), { id: "sbx", account: "e2b", expiresAt: null }),
    job: async () => (woke.push("job"), view()),
    wait: async () => (woke.push("job"), view()),
    cancel: async () => (woke.push("cancel"), view()),
    resume: async () => (woke.push("resume"), { id: "sbx", state: "running" }),
    pause: async () => (woke.push("pause"), { id: "sbx", state: "paused" }),
    exec: async (_ref: unknown, input: (typeof execs)[number]) => (
      execs.push(input),
      {
        job: { id: "job_1", snapshotId: null },
        state: { ...state, startedAt: null, finishedAt: null, processAlive: false },
        log: { text: "", offset: 0, nextOffset: 0, totalBytes: 0 },
      }
    ),
    sync: async (_ref: unknown, captured: Awaited<ReturnType<typeof actual.captureSource>>) => ({
      snapshot: captured.snapshot,
      verified: true,
    }),
  }),
}));
/** Answers for the setup prompts, in order. */
const answers: unknown[] = [];
const next = async () => answers.shift();
const actualUi = await import("../ui.js");
mock.module("../ui.js", () => ({ ...actualUi, choose: next, ask: next, confirm: next }));
// Signing in sets a token for the test server; nothing is written to this machine's login.
mock.module("./auth.js", () => ({
  signIn: async () => {
    process.env.GITTERM_API_TOKEN = "gt_test";
  },
}));
const {
  runSandboxCreate,
  runSandboxExec,
  runSandboxJob,
  runSandboxPause,
  runSandboxResume,
  runSandboxSetup,
  runSandboxSync,
  setUpOwnProvider,
} = await import("./sandbox.js");

afterEach(() => {
  process.exitCode = 0;
});

async function withSettings<T>(options: Record<string, unknown>, run: () => Promise<T>) {
  const directory = await mkdtemp(path.join(tmpdir(), "gitterm-cli-"));
  const previous = process.env.GITTERM_SANDBOX_CONFIG;
  process.env.GITTERM_SANDBOX_CONFIG = path.join(directory, "sandbox.json");
  try {
    await writeFile(
      process.env.GITTERM_SANDBOX_CONFIG,
      JSON.stringify({
        account: "e2b",
        accounts: { e2b: { provider: "e2b", apiKey: "{env:E2B_API_KEY}" } },
        ...options,
      }),
    );
    return await run();
  } finally {
    if (previous === undefined) delete process.env.GITTERM_SANDBOX_CONFIG;
    else process.env.GITTERM_SANDBOX_CONFIG = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

async function exec() {
  return withSettings({}, async () => {
    await runSandboxExec({ sandboxId: "sbx", command: "npm test", json: true });
    return process.exitCode;
  });
}

test("exec exits with the job's exit code when the command fails", async () => {
  state = { status: "failed", exitCode: 7 };
  expect(await exec()).toBe(7);
});

test("exec fails when the job timed out without an exit code", async () => {
  state = { status: "timed_out", exitCode: null };
  expect(await exec()).toBe(1);
});

test("exec exits 0 when the command succeeds", async () => {
  state = { status: "succeeded", exitCode: 0 };
  expect(await exec()).toBe(0);
});

test("sync takes the source limit from the settings file", async () => {
  const exclude = ["fixtures/large/**"];
  captures.length = 0;
  await withSettings({ exclude, maxSourceMiB: 512 }, () =>
    runSandboxSync({ sandboxId: "sbx", json: true, yes: true }),
  );
  expect(captures).toEqual([{ exclude, maxBytes: 536870912 }]);
});

test("sync exits with an error for an invalid source limit without capturing source", async () => {
  captures.length = 0;
  const exit = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit");
  });
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      withSettings({ maxSourceMiB: 0 }, () =>
        runSandboxSync({ sandboxId: "sbx", json: true, yes: true }),
      ),
    ).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("maxSourceMiB"));
    expect(captures).toHaveLength(0);
  } finally {
    error.mockRestore();
    exit.mockRestore();
  }
});

test("a literal key in the settings file is refused; {env:VAR} is the way to give one", async () => {
  const exit = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit");
  });
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      withSettings({ accounts: { e2b: { provider: "e2b", apiKey: "e2b_literal" } } }, () =>
        runSandboxSync({ sandboxId: "sbx", json: true, yes: true }),
      ),
    ).rejects.toThrow("exit");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("{env:VAR}"));
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining("e2b_literal"));
  } finally {
    error.mockRestore();
    exit.mockRestore();
  }
});

test("exec in the background returns at once, for the session, with env files and approved secrets", async () => {
  state = { status: "running", exitCode: null };
  execs.length = 0;
  const directory = await mkdtemp(path.join(tmpdir(), "gitterm-checkout-"));
  await writeFile(path.join(directory, ".env.test"), "FROM_FILE=1\n");
  process.env.GITTERM_TEST_SECRET = "s3cret-value";
  try {
    await withSettings({ envFiles: [".env.test"] }, () =>
      runSandboxExec({
        sandboxId: "sbx",
        command: "bun test",
        background: true,
        session: "ses-1",
        secretEnv: ["GITTERM_TEST_SECRET"],
        dir: directory,
        yes: true,
        json: true,
      }),
    );
    expect(execs).toEqual([
      expect.objectContaining({
        command: "bun test",
        waitMs: 0,
        sessionId: "ses-1",
        env: { FROM_FILE: "1", GITTERM_TEST_SECRET: "s3cret-value" },
      }),
    ]);
  } finally {
    delete process.env.GITTERM_TEST_SECRET;
    await rm(directory, { recursive: true, force: true });
  }
});

test("exec refuses to pass a secret without approval", async () => {
  execs.length = 0;
  process.env.GITTERM_TEST_SECRET = "s3cret-value";
  const exit = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit");
  });
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      withSettings({}, () =>
        runSandboxExec({
          sandboxId: "sbx",
          command: "bun test",
          secretEnv: ["GITTERM_TEST_SECRET"],
          json: true,
        }),
      ),
    ).rejects.toThrow("exit");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("--yes"));
    expect(execs).toHaveLength(0);
  } finally {
    delete process.env.GITTERM_TEST_SECRET;
    error.mockRestore();
    exit.mockRestore();
  }
});

test("sync asks once per project: NEEDS_APPROVAL, then --always, then no more asking", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gitterm-home-"));
  const checkout = await mkdtemp(path.join(tmpdir(), "gitterm-checkout-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  const exit = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit");
  });
  const error = spyOn(console, "error").mockImplementation(() => {});
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await withSettings({}, async () => {
      captures.length = 0;
      // No terminal, no --yes: the agent is told to ask.
      await expect(runSandboxSync({ sandboxId: "sbx", dir: checkout, json: true })).rejects.toThrow(
        "exit",
      );
      expect(error).toHaveBeenCalledWith(expect.stringContaining("NEEDS_APPROVAL"));
      // "Always in this project", then a later sync there runs without --yes.
      await runSandboxSync({ sandboxId: "sbx", dir: checkout, json: true, always: true });
      await runSandboxSync({ sandboxId: "sbx", dir: checkout, json: true });
      expect(captures).toHaveLength(3);
    });
  } finally {
    process.env.HOME = previousHome;
    log.mockRestore();
    error.mockRestore();
    exit.mockRestore();
    await rm(home, { recursive: true, force: true });
    await rm(checkout, { recursive: true, force: true });
  }
});

/** Runs `run` in a throwaway HOME and checkout, catching the CLI's exit and its errors. */
async function inProject(run: (checkout: string, errors: string[]) => Promise<void>) {
  const home = await mkdtemp(path.join(tmpdir(), "gitterm-home-"));
  const checkout = await mkdtemp(path.join(tmpdir(), "gitterm-checkout-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  const errors: string[] = [];
  const exit = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit");
  });
  const error = spyOn(console, "error").mockImplementation((text) => void errors.push(text));
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await withSettings({}, () => run(checkout, errors));
  } finally {
    process.env.HOME = previousHome;
    log.mockRestore();
    error.mockRestore();
    exit.mockRestore();
    await rm(home, { recursive: true, force: true });
    await rm(checkout, { recursive: true, force: true });
  }
}

test("with sandboxes off for the project, nothing wakes a sandbox; pausing still works", async () => {
  await inProject(async (checkout) => {
    setProjectFeatures(checkout, ["sandbox"], false);
    woke.length = 0;
    const base = { sandboxId: "sbx", dir: checkout, json: true };
    await expect(runSandboxJob({ ...base, jobId: "job_1", wait: 5 })).rejects.toThrow("exit");
    await expect(runSandboxResume(base)).rejects.toThrow("exit");
    await expect(runSandboxCreate({ ...base, yes: true })).rejects.toThrow("exit");
    await runSandboxPause(base);
    expect(woke).toEqual(["pause"]);
  });
});

test("create with public previews asks one question that --always cannot answer", async () => {
  await inProject(async (checkout, errors) => {
    woke.length = 0;
    const args = { dir: checkout, json: true, public: true };
    await expect(runSandboxCreate({ ...args, always: true })).rejects.toThrow("exit");
    const { error } = JSON.parse(errors.at(-1)!);
    expect(error).toMatchObject({ code: "NEEDS_APPROVAL", always: false });
    expect(error.question).toContain("public");
    expect(woke).toEqual([]);
    await runSandboxCreate({ ...args, yes: true });
    expect(woke).toEqual(["create"]);
  });
});

test("setup with a rejected key leaves the working account and writes no key", async () => {
  await inProject(async () => {
    const file = process.env.GITTERM_SANDBOX_CONFIG!;
    const before = await readFile(file, "utf8");
    // E2B, paste a key.
    answers.push(0, 0, "bad-key");
    await expect(setUpOwnProvider()).rejects.toThrow("E2B rejected the key");
    expect(await readFile(file, "utf8")).toBe(before);
    expect(existsSync(path.join(path.dirname(file), "keys"))).toBe(false);
    // A key the provider accepts is saved, and the account before it is kept.
    answers.push(0, 0, "good-key");
    await setUpOwnProvider();
    const saved = JSON.parse(await readFile(file, "utf8"));
    const keyFile = path.join(path.dirname(file), "keys", "e2b");
    expect(saved).toMatchObject({
      account: "e2b",
      accounts: { e2b: { apiKey: `{file:${keyFile}}` } },
    });
    expect(await readFile(keyFile, "utf8")).toBe("good-key\n");

    // Rotating the key changes the key only: the account's other settings stay.
    saved.accounts.e2b = { ...saved.accounts.e2b, template: "big", snapshot: "snap_1" };
    await writeFile(file, JSON.stringify(saved));
    answers.push(0, 0, "new-key");
    await setUpOwnProvider();
    expect(JSON.parse(await readFile(file, "utf8")).accounts.e2b).toEqual({
      provider: "e2b",
      apiKey: `{file:${keyFile}}`,
      template: "big",
      snapshot: "snap_1",
    });
    expect(await readFile(keyFile, "utf8")).toBe("new-key\n");
    // A rejected rotation leaves that account and its key as they were.
    const rotated = await readFile(file, "utf8");
    answers.push(0, 0, "bad-key");
    await expect(setUpOwnProvider()).rejects.toThrow("E2B rejected the key");
    expect(await readFile(file, "utf8")).toBe(rotated);
    expect(await readFile(keyFile, "utf8")).toBe("new-key\n");
  });
});

test("setup on the GitTerm plan signs in first, and a non-default provider stays a GitTerm account", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname.endsWith("/sandbox.providers")
        ? Response.json([
            { result: { data: { providers: ["gitterm", "e2b"], default: "gitterm" } } },
          ])
        : new Response("not found", { status: 404 }),
  });
  const saved = {
    url: process.env.GITTERM_SERVER_URL,
    token: process.env.GITTERM_API_TOKEN,
    tty: process.stdin.isTTY,
  };
  process.env.GITTERM_SERVER_URL = server.url.origin;
  delete process.env.GITTERM_API_TOKEN;
  process.stdin.isTTY = true;
  try {
    await inProject(async () => {
      // GitTerm plan, sign in, E2B (not the default), the plan's size.
      answers.push(0, true, 1, "");
      await runSandboxSetup();
      const settings = JSON.parse(await readFile(process.env.GITTERM_SANDBOX_CONFIG!, "utf8"));
      expect(settings.accounts.gitterm).toEqual({ serverUrl: server.url.origin, provider: "e2b" });
      const { loadSandboxSettingsFile, resolveSandboxAccount } = actual;
      const account = await resolveSandboxAccount(loadSandboxSettingsFile()!, "gitterm");
      expect(account).toMatchObject({ ownKey: false, provider: "e2b" });

      // Run again: the default provider, which clears E2B, and a size.
      answers.push(0, true, 0, "small");
      await runSandboxSetup();
      expect(
        JSON.parse(await readFile(process.env.GITTERM_SANDBOX_CONFIG!, "utf8")).accounts.gitterm,
      ).toEqual({ serverUrl: server.url.origin, size: "small" });
    });
  } finally {
    server.stop(true);
    process.stdin.isTTY = saved.tty;
    for (const [name, value] of [
      ["GITTERM_SERVER_URL", saved.url],
      ["GITTERM_API_TOKEN", saved.token],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
});
