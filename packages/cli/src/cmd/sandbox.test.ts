import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let state = { status: "failed", exitCode: 7 as number | null };
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
  createSandboxBackend: () => ({}),
  createSandboxClient: () => ({
    identity: { mode: "direct", account: "e2b", provider: "e2b" },
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
const { runSandboxExec, runSandboxSync } = await import("./sandbox.js");

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
