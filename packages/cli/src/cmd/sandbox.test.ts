import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let state = { status: "failed", exitCode: 7 as number | null };
const actual = await import("@gitterm/sdk/sandbox");
mock.module("@gitterm/sdk/sandbox", () => ({
  ...actual,
  createSandboxBackend: () => ({}),
  createSandboxClient: () => ({
    identity: { mode: "direct", account: "e2b", provider: "e2b" },
    exec: async () => ({
      job: { id: "job_1", snapshotId: null },
      state: { ...state, startedAt: null, finishedAt: null, processAlive: false },
      log: { text: "", offset: 0, nextOffset: 0, totalBytes: 0 },
    }),
  }),
}));
const { runSandboxExec } = await import("./sandbox.js");

afterEach(() => {
  process.exitCode = 0;
});

async function exec() {
  const directory = await mkdtemp(path.join(tmpdir(), "gitterm-cli-"));
  process.env.GITTERM_SANDBOX_CONFIG = path.join(directory, "sandbox.json");
  await writeFile(
    process.env.GITTERM_SANDBOX_CONFIG,
    JSON.stringify({
      account: "e2b",
      accounts: { e2b: { provider: "e2b", apiKeyEnv: "E2B_API_KEY" } },
    }),
  );
  try {
    await runSandboxExec({ sandboxId: "sbx", command: "npm test", json: true });
    return process.exitCode;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
