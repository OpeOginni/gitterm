#!/usr/bin/env bun
/**
 * Live end-to-end smoke test for agent sandboxes. Creates real, billable sandboxes.
 *
 *   GITTERM_SANDBOX_CONFIG=./sandbox.json bun run scripts/sandbox-smoke.ts --account <name> [--crash]
 *
 * The settings file uses the CLI shape (keys only via `apiKeyEnv`). Each run uses an
 * isolated fixture repository and a unique label; every sandbox carrying that label is
 * destroyed in `finally`, and the provider is queried to confirm. Readiness waits are
 * bounded; assertions are not retried.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  captureSource,
  createSandboxBackend,
  createSandboxClient,
  createFileSandboxStore,
  describeSandboxAccount,
  type SandboxRecord,
  type SandboxSettings,
} from "../packages/sdk/src/sandbox/index";
import { artifactDirectory } from "../packages/sdk/src/sandbox/artifacts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const settingsPath = process.env.GITTERM_SANDBOX_CONFIG;
if (!settingsPath) throw new Error("Set GITTERM_SANDBOX_CONFIG to a sandbox settings file");
const settings = JSON.parse(await readFile(settingsPath, "utf8")) as SandboxSettings;
for (const account of Object.values(settings.accounts ?? {}))
  if ("apiKey" in account || "token" in account)
    throw new Error("Use apiKeyEnv; the settings file must not hold credentials");
settings.account = option("account") ?? settings.account;

if (flag("child-create")) {
  // Crash-test child: create a 1-minute sandbox, announce it, then wait to be killed.
  const child = createSandboxClient({
    backend: createSandboxBackend(settings),
    limits: { maxSandboxes: 5 },
  });
  const created = await child.create({
    name: "crash test",
    purpose: `${process.env.GITTERM_SMOKE_RUN}-crash`,
    lifetimeMinutes: 1,
  });
  console.log(`CREATED ${created.id}`);
  await new Promise(() => {});
}

const runId = `smoke-${randomBytes(4).toString("hex")}`;
const SENTINEL = `gitterm-sentinel-${randomBytes(12).toString("hex")}`;
const secretsToFind = [
  SENTINEL,
  ...Object.values(settings.accounts ?? {}).flatMap((account) =>
    "apiKeyEnv" in account && account.apiKeyEnv && process.env[account.apiKeyEnv]
      ? [process.env[account.apiKeyEnv]!]
      : [],
  ),
  ...(process.env.GITTERM_API_TOKEN ? [process.env.GITTERM_API_TOKEN] : []),
];

let failures = 0;
const results: Array<{ check: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  // Details never include secret values: everything printed passes through scrub().
  const clean = scrub(detail);
  results.push({ check: name, ok, detail: clean });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${clean ? `  — ${clean}` : ""}`);
}
function scrub(text: string) {
  let out = text;
  for (const secret of secretsToFind) if (secret) out = out.replaceAll(secret, "[secret]");
  return out.replace(/\s+/g, " ").slice(0, 300);
}

const work = await mkdtemp(path.join(tmpdir(), `gitterm-${runId}-`));
const repo = path.join(work, "repo");
const store = createFileSandboxStore(path.join(work, "store"));
const summary = describeSandboxAccount(settings);
console.log(
  `run ${runId}: ${summary.mode}/${summary.name} (${summary.provider}); charged to ${summary.chargedTo}; credential from ${summary.credentialSource}`,
);
const client = createSandboxClient({
  backend: createSandboxBackend(settings),
  store,
  limits: { maxSandboxes: 5, maxLifetimeMinutes: 15, maxJobMinutes: 10 },
});
let sandbox: SandboxRecord | undefined;
/** Every id this run created, for cleanup on providers that cannot keep labels. */
const createdIds = new Set<string>();

const git = (...gitArgs: string[]) => execFileSync("git", gitArgs, { cwd: repo, stdio: "pipe" });

try {
  // Fixture: committed test fails; the uncommitted edit makes it pass.
  execFileSync("mkdir", ["-p", repo]);
  git("init", "-q");
  git("config", "user.email", "smoke@example.com");
  git("config", "user.name", "Smoke");
  await writeFile(path.join(repo, "answer.js"), "module.exports = 41;\n");
  await writeFile(
    path.join(repo, "test.js"),
    'const a = require("./answer"); console.log("answer", a); process.exit(a === 42 ? 0 : 1);\n',
  );
  await writeFile(path.join(repo, "removed.txt"), "tracked, deleted locally\n");
  await writeFile(path.join(repo, "logo.bin"), randomBytes(4096));
  git("add", ".");
  git("commit", "-qm", "fixture");
  await writeFile(path.join(repo, "answer.js"), "module.exports = 42;\n");
  await writeFile(path.join(repo, "notes.txt"), "approved untracked file\n");
  await rm(path.join(repo, "removed.txt"));
  await writeFile(path.join(repo, ".env"), `API_TOKEN=${SENTINEL}\n`);
  const localBefore = execFileSync("git", ["status", "--porcelain"], { cwd: repo }).toString();

  sandbox = await client.create({
    name: `smoke ${runId}`,
    purpose: runId,
    project: repo,
    lifetimeMinutes: 15,
    // Providers without private previews need the public-sharing opt-in.
    publicPreviews: client.capabilities.previews === "public",
  });
  createdIds.add(sandbox.id);
  check(
    "create",
    sandbox.state === "running",
    `${sandbox.mode}/${sandbox.account} ${sandbox.id} expires ${sandbox.expiresAt}`,
  );

  const runtime = await client.exec(sandbox, {
    command:
      "for p in /proc/[0-9]*; do tr '\\0' ' ' < $p/cmdline 2>/dev/null; echo; done | grep -ciE '[o]pencode|[t]3code|[c]laude|[c]odex' || true; " +
      "env | grep -ciE '^(ANTHROPIC|OPENAI|OPENROUTER|OPENCODE|GEMINI|GOOGLE_API)[A-Z_]*=' || true; " +
      "command -v opencode t3code claude codex || true",
    waitMs: 60_000,
  });
  const [agentProcesses, modelEnv, ...binaries] = runtime.log.text.trim().split("\n");
  check(
    "no agent running and no model credentials",
    runtime.state.status === "succeeded" && agentProcesses === "0" && modelEnv === "0",
    `agent processes ${agentProcesses}, model variables ${modelEnv}`,
  );
  // Boat cannot use a custom image; its base image ships agent CLIs that are never started.
  check(
    summary.provider === "boat"
      ? "agent CLIs present but unused (Boat base image)"
      : "no agent CLIs installed",
    summary.provider === "boat" || binaries.filter(Boolean).length === 0,
    binaries.filter(Boolean).join(", ") || "none",
  );

  const captured = await captureSource(repo);
  check(
    "secret file excluded locally",
    captured.snapshot.excluded.some((item) => item.path === ".env") &&
      !captured.archive.includes(Buffer.from(SENTINEL)),
  );
  const synced = await client.sync(sandbox, captured);
  check("sync verified", synced.verified, `${captured.snapshot.id} ${captured.snapshot.digest}`);

  const test = await client.exec(sandbox, {
    command: `node test.js && test -f notes.txt && test ! -e removed.txt && test ! -e .env && sha256sum logo.bin && cat ${client.home}/.gitterm/source/current.digest`,
    waitMs: 120_000,
  });
  const logoHash = createHash("sha256")
    .update(await readFile(path.join(repo, "logo.bin")))
    .digest("hex");
  check(
    "uncommitted edit runs remotely",
    test.state.status === "succeeded" &&
      test.log.text.includes("answer 42") &&
      test.log.text.includes(captured.snapshot.digest) &&
      test.log.text.includes(logoHash),
    `status ${test.state.status}, exit ${test.state.exitCode}, digest ${captured.snapshot.digest}`,
  );

  const failed = await client.exec(sandbox, { command: "echo failing; exit 7", waitMs: 60_000 });
  check(
    "non-zero exit is a command failure",
    failed.state.status === "failed" && failed.state.exitCode === 7,
  );

  const timedOut = await client.exec(sandbox, {
    command: "sleep 600 & sleep 600",
    timeoutMinutes: 0.1,
    waitMs: 60_000,
  });
  check(
    "timeout kills the process group",
    timedOut.state.status === "timed_out" && !timedOut.state.processAlive,
    `status ${timedOut.state.status}, alive ${timedOut.state.processAlive}`,
  );

  const big = await client.exec(sandbox, {
    command: "head -c 3000000 /dev/zero | tr '\\0' 'y'; echo; echo DONE",
    waitMs: 120_000,
  });
  const page = await client.job(sandbox, big.job.id, { offset: 0, limit: 64 });
  check(
    "oversized output bounded and pageable",
    big.log.text.length <= 8192 &&
      big.log.totalBytes > 3_000_000 &&
      big.log.text.includes("DONE") &&
      page.log.text === "y".repeat(64),
    `${big.log.totalBytes} bytes total, ${big.log.text.length} returned`,
  );

  const long = await client.exec(sandbox, { command: "echo started; sleep 900 & sleep 900" });
  const restarted = createSandboxClient({ backend: createSandboxBackend(settings), store });
  const saved = (await restarted.list()).find((record) => record.id === sandbox!.id);
  const reattached = await restarted.job(saved!, long.job.id);
  check(
    "reattach after restart",
    reattached.state.status === "running" &&
      reattached.state.processAlive &&
      reattached.log.text.includes("started"),
  );
  const cancelled = await restarted.cancel(saved!, long.job.id);
  const sleepers = await restarted.exec(saved!, {
    command:
      "for p in /proc/[0-9]*; do tr '\\0' ' ' < $p/cmdline 2>/dev/null; echo; done | grep -c '^sleep 900' || true",
    waitMs: 60_000,
  });
  check(
    "cancel stops the remote processes",
    cancelled.state.status === "cancelled" &&
      !cancelled.state.processAlive &&
      sleepers.log.text.trim() === "0",
    `alive ${cancelled.state.processAlive}, remaining sleepers ${sleepers.log.text.trim()}`,
  );

  const preview = await client.preview(sandbox, {
    port: 8000,
    command: `node -e 'require("http").createServer((q,r)=>r.end("preview ${runId}")).listen(8000)'`,
    readyTimeoutMs: 60_000,
  });
  const authed = await fetch(preview.url, { headers: preview.headers }).then(async (r) => ({
    status: r.status,
    text: await r.text(),
  }));
  check(
    "preview serves the app",
    preview.ready && authed.status === 200 && authed.text === `preview ${runId}`,
  );
  check(
    preview.public
      ? "public preview (provider has no private previews) is open"
      : "unauthenticated preview rejected",
    preview.public
      ? preview.unauthenticatedStatus === 200
      : preview.unauthenticatedStatus !== null &&
          preview.unauthenticatedStatus >= 400 &&
          preview.unauthenticatedStatus < 500,
    `status ${preview.unauthenticatedStatus}`,
  );

  const build = await client.exec(sandbox, {
    command:
      "mkdir -p dist && head -c 1048576 /dev/urandom > dist/app.bin && sha256sum dist/app.bin",
    waitMs: 60_000,
  });
  const artifact = await client.fetchArtifact(sandbox, "dist/app.bin", { jobId: build.job.id });
  const localHash = createHash("sha256")
    .update(await readFile(artifact.localPath))
    .digest("hex");
  check(
    "binary artifact hashes match",
    artifact.verified && localHash === artifact.sha256 && build.log.text.includes(artifact.sha256),
    artifact.sha256,
  );

  const secret = await client.exec(sandbox, {
    command: 'echo "token=$API_TOKEN"',
    env: { API_TOKEN: SENTINEL },
    waitMs: 60_000,
  });
  check(
    "secret value redacted from output",
    secret.log.text.includes("token=[redacted]") && !secret.log.text.includes(SENTINEL),
  );

  const localAfter = execFileSync("git", ["status", "--porcelain"], { cwd: repo }).toString();
  check("local checkout unchanged", localBefore === localAfter);

  const destroyed = await client.destroy(sandbox);
  check("destroy confirmed by provider", destroyed.state === "terminated");
  sandbox = undefined;

  if (flag("crash") && client.capabilities.expiry === "none") {
    check("caller crash", true, `skipped: ${summary.provider} never deletes sandboxes on its own`);
  } else if (flag("crash")) {
    // A child creates a 1-minute sandbox and is SIGKILLed; the provider must delete it.
    const child = spawn(
      process.execPath,
      [import.meta.path, "--child-create", "--account", settings.account ?? ""],
      {
        env: {
          ...process.env,
          GITTERM_SMOKE_RUN: runId,
          XDG_STATE_HOME: path.join(work, "child-state"),
        },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    const id = await new Promise<string>((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        const match = /CREATED (\S+)/.exec(chunk.toString());
        if (match) {
          child.kill("SIGKILL");
          createdIds.add(match[1]!);
          resolve(match[1]!);
        }
      });
      child.on("exit", () => reject(new Error("child exited before creating a sandbox")));
    });
    const backend = createSandboxBackend(settings);
    const deadline = Date.now() + 5 * 60_000;
    // Boat archives rather than deletes at the lifetime.
    const expected = client.capabilities.expiry === "archive" ? "paused" : "terminated";
    let state = (await backend.get(id)).state;
    while (state !== expected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      state = (await backend.get(id)).state;
    }
    check(
      `caller crash: provider expiry leaves the sandbox ${expected === "paused" ? "archived" : "deleted"}`,
      state === expected,
      `${id} ${state}`,
    );
  }
} catch (error) {
  check("smoke run", false, error instanceof Error ? error.message : String(error));
} finally {
  // Remove anything this run created, including after a failure.
  const backend = createSandboxBackend(settings);
  const leftovers = new Set(createdIds);
  for (const info of await backend.list().catch(() => []))
    if (info.labels.gitterm_purpose?.startsWith(runId)) leftovers.add(info.id);
  for (const id of leftovers) {
    const before = await backend.get(id).catch(() => null);
    if (before?.state === "terminated") continue;
    await backend.destroy(id).catch(() => {});
    const after = await backend.get(id).catch(() => null);
    check(`cleanup ${id}`, after?.state === "terminated", `was ${before?.state ?? "unknown"}`);
  }
  // Leak scan: nothing local this run wrote may contain a credential or the sentinel.
  const scanned: string[] = [];
  const scan = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(full);
      else {
        scanned.push(full);
        const text = (await readFile(full)).toString("latin1");
        if (secretsToFind.some((secret) => secret && text.includes(secret)))
          check(`no secret in ${full}`, false);
      }
    }
  };
  await scan(path.join(work, "store"));
  await scan(artifactDirectory());
  check("leak scan of store and artifacts", true, `${scanned.length} files scanned`);
  await rm(work, { recursive: true, force: true });
}

console.log(
  JSON.stringify({ runId, account: summary.name, mode: summary.mode, failures, results }, null, 2),
);
process.exit(failures ? 1 : 0);
