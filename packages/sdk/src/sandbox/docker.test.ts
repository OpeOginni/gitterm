import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyArtifact, ArtifactConflictError } from "./artifacts";
import { createSandboxClient, type SandboxClient } from "./client";
import {
  createDockerSandboxBackend,
  createExecServerDockerBackend,
  dockerAvailable,
} from "./docker-backend.test-helper";
import { captureSource } from "./source";
import { createFileSandboxStore } from "./store";
import type { SandboxRecord } from "./store";

/**
 * Job, sync, preview, and artifact behavior against a real Linux container.
 * Opt in: GITTERM_SANDBOX_DOCKER_TESTS=1 bun test packages/sdk/src/sandbox/docker.test.ts
 */
const enabled = process.env.GITTERM_SANDBOX_DOCKER_TESTS === "1" && (await dockerAvailable());
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
const SENTINEL = `sentinel-${randomBytes(8).toString("hex")}`;

const backends = {
  "docker exec": createDockerSandboxBackend,
  "command server (Railway/AWS path)": createExecServerDockerBackend,
};

for (const [kind, createBackend] of Object.entries(backends))
  describe.skipIf(!enabled)(`sandbox jobs in a Docker container via ${kind}`, () => {
    const run = `test-${randomBytes(4).toString("hex")}`;
    let work: string;
    let repo: string;
    let storeDir: string;
    let client: SandboxClient;
    let sandbox: SandboxRecord;

    beforeAll(async () => {
      work = await mkdtemp(path.join(tmpdir(), "gitterm-sandbox-test-"));
      repo = path.join(work, "repo");
      storeDir = path.join(work, "store");
      execFileSync("mkdir", ["-p", repo]);
      sh(repo, "init", "-q");
      sh(repo, "config", "user.email", "test@example.com");
      sh(repo, "config", "user.name", "Test");
      await writeFile(path.join(repo, "answer.js"), "module.exports = 41;\n");
      await writeFile(
        path.join(repo, "test.js"),
        'const a = require("./answer"); console.log("answer", a); process.exit(a === 42 ? 0 : 1);\n',
      );
      await writeFile(path.join(repo, "removed.txt"), "tracked then deleted\n");
      await writeFile(path.join(repo, ".gitignore"), "node_modules\n");
      sh(repo, "add", ".");
      sh(repo, "commit", "-qm", "init");
      // Uncommitted state: the edit makes the test pass; untracked file, deletion, secret file.
      await writeFile(path.join(repo, "answer.js"), "module.exports = 42;\n");
      await writeFile(path.join(repo, "extra.txt"), "approved untracked\n");
      await rm(path.join(repo, "removed.txt"));
      await writeFile(path.join(repo, ".env"), `TOKEN=${SENTINEL}\n`);

      client = createSandboxClient({
        backend: createBackend("docker-a", run),
        store: createFileSandboxStore(storeDir),
        limits: { maxSandboxes: 2, maxLifetimeMinutes: 30, maxJobMinutes: 5 },
      });
      sandbox = await client.create({
        name: "docker test",
        purpose: "test",
        project: repo,
        lifetimeMinutes: 20,
      });
    }, 120_000);

    afterAll(async () => {
      if (sandbox) await client.destroy(sandbox).catch(() => {});
      if (work) await rm(work, { recursive: true, force: true });
    });

    test("runs the exact local checkout, including uncommitted changes", async () => {
      const captured = await captureSource(repo);
      expect(captured.snapshot.excluded.map((item) => item.path)).toEqual([".env"]);
      expect(captured.snapshot.deleted).toEqual(["removed.txt"]);
      expect(captured.snapshot.untracked).toEqual(["extra.txt"]);
      expect(captured.archive.includes(Buffer.from(SENTINEL))).toBe(false);
      const synced = await client.sync(sandbox, captured);
      expect(synced.verified).toBe(true);

      const result = await client.exec(sandbox, {
        command:
          "node test.js && test -f extra.txt && test ! -e removed.txt && test ! -e .env && cat ~/.gitterm/source/current.digest",
        waitMs: 60_000,
      });
      expect(result.state.status).toBe("succeeded");
      expect(result.log.text).toContain("answer 42");
      expect(result.log.text).toContain(captured.snapshot.digest);
      expect(result.job.snapshotDigest).toBe(captured.snapshot.digest);
    }, 120_000);

    test("a later sync deletes files removed locally", async () => {
      await rm(path.join(repo, "extra.txt"));
      await client.sync(sandbox, await captureSource(repo));
      const result = await client.exec(sandbox, { command: "test ! -e extra.txt", waitMs: 30_000 });
      expect(result.state.status).toBe("succeeded");
    }, 60_000);

    test("reports a non-zero exit as a command failure", async () => {
      const result = await client.exec(sandbox, { command: "echo nope; exit 3", waitMs: 30_000 });
      expect(result.state).toMatchObject({ status: "failed", exitCode: 3, processAlive: false });
      expect(result.state.finishedAt).not.toBeNull();
    }, 60_000);

    test("times out and kills the whole process group", async () => {
      const result = await client.exec(sandbox, {
        command: "sh -c 'sleep 300' & sleep 300",
        timeoutMinutes: 0.05,
        waitMs: 30_000,
      });
      expect(result.state.status).toBe("timed_out");
      expect(result.state.processAlive).toBe(false);
    }, 60_000);

    test("bounds oversized output and pages through the rest", async () => {
      const result = await client.exec(sandbox, {
        command: "head -c 2000000 /dev/zero | tr '\\0' 'x'; echo; echo END",
        waitMs: 60_000,
      });
      expect(result.state.status).toBe("succeeded");
      expect(result.log.totalBytes).toBeGreaterThan(2_000_000);
      expect(result.log.text.length).toBeLessThanOrEqual(8 * 1024);
      expect(result.log.text).toContain("END");
      const first = await client.job(sandbox, result.job.id, { offset: 0, limit: 100 });
      expect(first.log.text).toBe("x".repeat(100));
      expect(first.log.nextOffset).toBe(100);
    }, 120_000);

    test("cancels the remote process, and a new client reattaches to saved jobs", async () => {
      const started = await client.exec(sandbox, {
        command: "echo begin; sh -c 'sleep 300' & sleep 300",
      });
      expect(started.state.status).toBe("running");
      expect(started.state.processAlive).toBe(true);

      // Simulates a plugin restart: fresh client, same on-disk records.
      const restarted = createSandboxClient({
        backend: createBackend("docker-a", run),
        store: createFileSandboxStore(storeDir),
      });
      const [listed] = (await restarted.list()).filter((item) => item.id === sandbox.id);
      expect(listed?.jobs[started.job.id]?.status).toBe("running");
      const reattached = await restarted.job(listed!, started.job.id);
      expect(reattached.state).toMatchObject({ status: "running", processAlive: true });
      expect(reattached.log.text).toContain("begin");

      const cancelled = await restarted.cancel(listed!, started.job.id);
      expect(cancelled.state).toMatchObject({ status: "cancelled", processAlive: false });
      const processes = await restarted.exec(listed!, {
        command:
          "ls /proc | grep -E '^[0-9]+$' | while read p; do cat /proc/$p/cmdline 2>/dev/null | tr '\\0' ' '; echo; done | grep -c '^sleep 300' || true",
        waitMs: 30_000,
      });
      expect(processes.log.text.trim()).toBe("0");
    }, 120_000);

    test("serves a private preview and returns a binary artifact with matching hashes", async () => {
      const preview = await client.preview(sandbox, {
        port: 8000,
        command: `node -e 'require("http").createServer((q,r)=>r.end("hello preview")).listen(8000)'`,
        readyTimeoutMs: 30_000,
      });
      expect(preview.ready).toBe(true);
      expect(await (await fetch(preview.url, { headers: preview.headers })).text()).toBe(
        "hello preview",
      );
      // Behind the command server, a request without the token is rejected.
      if (Object.keys(preview.headers).length) expect(preview.unauthenticatedStatus).toBe(401);

      const built = await client.exec(sandbox, {
        command: "mkdir -p dist && head -c 300000 /dev/urandom > dist/app.bin",
        waitMs: 30_000,
      });
      expect(built.state.status).toBe("succeeded");
      const artifact = await client.fetchArtifact(sandbox, "dist/app.bin");
      expect(artifact.verified).toBe(true);
      expect(
        createHash("sha256")
          .update(await readFile(artifact.localPath))
          .digest("hex"),
      ).toBe(artifact.sha256);
      expect(artifact.localPath.startsWith(repo)).toBe(false);

      const snapshot = (await captureSource(repo)).snapshot;
      await applyArtifact({ artifact, snapshot, target: "dist/app.bin" });
      expect(
        createHash("sha256")
          .update(await readFile(path.join(repo, "dist/app.bin")))
          .digest("hex"),
      ).toBe(artifact.sha256);
      // A local edit after the snapshot makes a second apply stale.
      await writeFile(path.join(repo, "answer.js"), "module.exports = 43;\n");
      await expect(
        applyArtifact({ artifact, snapshot, target: "answer.js" }),
      ).rejects.toBeInstanceOf(ArtifactConflictError);
    }, 120_000);

    test("keeps secret values out of output, records, and the snapshot", async () => {
      const result = await client.exec(sandbox, {
        command: 'echo "value=$API_TOKEN"',
        env: { API_TOKEN: SENTINEL },
        waitMs: 30_000,
      });
      expect(result.log.text).toContain("value=[redacted]");
      expect(result.job.secretNames).toEqual(["API_TOKEN"]);
      for (const file of await readdir(storeDir, { recursive: true, withFileTypes: true }))
        if (file.isFile())
          expect(await readFile(path.join(file.parentPath, file.name), "utf8")).not.toContain(
            SENTINEL,
          );
    }, 60_000);

    test("a second account cannot operate this sandbox", async () => {
      const other = createSandboxClient({
        backend: createBackend("docker-b", run),
        store: createFileSandboxStore(storeDir),
      });
      await expect(other.get(sandbox)).rejects.toThrow(/belongs to direct account "docker-a"/);
      await expect(other.get({ ...sandbox, account: "docker-b" })).rejects.toThrow(
        /not created by direct account "docker-b"/,
      );
    });

    test("destroy removes the container", async () => {
      const destroyed = await client.destroy(sandbox);
      expect(destroyed.state).toBe("terminated");
      expect(
        execFileSync("docker", ["ps", "-aq", "--filter", `label=gitterm_test_run=${run}`])
          .toString()
          .trim(),
      ).toBe("");
    }, 60_000);
  });
