import { describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Deterministic account-isolation tests. The `e2b` module is replaced by an in-memory
 * provider that scopes sandboxes by API key, like real E2B teams.
 */
class AuthenticationError extends Error {}
class NotFoundError extends Error {}
class CommandExitError extends Error {}
class RateLimitError extends Error {}
class TimeoutError extends Error {}

type FakeSandbox = { id: string; key: string; metadata: Record<string, string>; state: "running" };
const sandboxes = new Map<string, FakeSandbox>();
const VALID_KEYS = new Set(["key-team-1", "key-team-2"]);
let failSetup = false;
const calls: string[] = [];

function auth(apiKey: string) {
  calls.push(`auth:${apiKey}`);
  if (!VALID_KEYS.has(apiKey)) throw new AuthenticationError("401 invalid key");
}
function find(id: string, apiKey: string) {
  auth(apiKey);
  const sandbox = sandboxes.get(id);
  if (!sandbox || sandbox.key !== apiKey) throw new NotFoundError("404");
  return sandbox;
}
const info = (sandbox: FakeSandbox) => ({
  sandboxId: sandbox.id,
  state: sandbox.state,
  metadata: sandbox.metadata,
  templateId: "base",
  startedAt: new Date(),
  endAt: new Date(Date.now() + 3_600_000),
});

mock.module("e2b", () => ({
  AuthenticationError,
  NotFoundError,
  CommandExitError,
  RateLimitError,
  TimeoutError,
  Sandbox: {
    async create(_template: string, options: { apiKey: string; metadata: Record<string, string> }) {
      auth(options.apiKey);
      const sandbox: FakeSandbox = {
        id: `sbx${sandboxes.size + 1}`,
        key: options.apiKey,
        metadata: options.metadata,
        state: "running",
      };
      sandboxes.set(sandbox.id, sandbox);
      return {
        sandboxId: sandbox.id,
        commands: {
          run: async () => {
            if (failSetup) throw new Error("setup failed");
            return { exitCode: 0, stdout: "", stderr: "" };
          },
        },
      };
    },
    async getInfo(id: string, options: { apiKey: string }) {
      return info(find(id, options.apiKey));
    },
    async connect(id: string, options: { apiKey: string }) {
      find(id, options.apiKey);
      return {
        commands: {
          run: async (command: string) => ({ exitCode: 0, stdout: `ran ${command}`, stderr: "" }),
        },
      };
    },
    list(options: { apiKey: string; query: { metadata: Record<string, string> } }) {
      auth(options.apiKey);
      let done = false;
      return {
        get hasNext() {
          return !done;
        },
        async nextItems() {
          done = true;
          return [...sandboxes.values()]
            .filter(
              (sandbox) =>
                sandbox.key === options.apiKey &&
                Object.entries(options.query.metadata).every(([k, v]) => sandbox.metadata[k] === v),
            )
            .map(info);
        },
      };
    },
    async kill(id: string, options: { apiKey: string }) {
      find(id, options.apiKey);
      sandboxes.delete(id);
      return true;
    },
  },
}));

const { createSandboxBackend, describeSandboxAccount } = await import("./config");
const { createSandboxClient } = await import("./client");
const backendModule = await import("./backend");
const { SandboxAccountError } = backendModule;
const { accountHash } = await import("@gitterm/agent-runtime/sandbox/types");
const { SandboxProviderError } = await import("@gitterm/agent-runtime/sandbox/types");
const { createFileSandboxStore } = await import("./store");
const { captureSource, globToRegExp } = await import("./source");
const { createTarGz } = await import("./tar");

const settings = {
  accounts: {
    personal: { mode: "direct" as const, provider: "e2b" as const, apiKey: "key-team-1" },
    // Same provider, same key, different account name.
    alias: { mode: "direct" as const, provider: "e2b" as const, apiKey: "key-team-1" },
    work: { mode: "direct" as const, provider: "e2b" as const, apiKey: "key-team-2" },
    broken: { mode: "direct" as const, provider: "e2b" as const, apiKey: "wrong" },
    empty: { mode: "direct" as const, provider: "e2b" as const, apiKey: "" },
    hosted: { mode: "managed" as const, serverUrl: "http://127.0.0.1:9", token: "gt_test" },
  },
};

async function clientFor(account: string) {
  const store = createFileSandboxStore(await mkdtemp(path.join(tmpdir(), "gitterm-store-")));
  return createSandboxClient({
    backend: createSandboxBackend(settings, account),
    store,
    limits: { maxSandboxes: 10 },
  });
}

describe("sandbox account isolation", () => {
  test("two credential identities cannot see or operate each other's sandboxes", async () => {
    const personal = await clientFor("personal");
    const work = await clientFor("work");
    const mine = await personal.create({ name: "a", lifetimeMinutes: 10 });
    expect(mine).toMatchObject({ mode: "direct", provider: "e2b", account: "personal" });
    expect(sandboxes.get(mine.id)?.key).toBe("key-team-1");

    // A ref for another account is rejected before any provider call.
    calls.length = 0;
    await expect(work.get(mine)).rejects.toBeInstanceOf(SandboxAccountError);
    expect(calls).toEqual([]);
    // Forging the account name makes the other team's provider answer "not found".
    expect((await work.get({ ...mine, account: "work" })).state).toBe("terminated");
    await expect(work.destroy({ ...mine, account: "work" })).resolves.toMatchObject({
      state: "terminated",
    });
    expect(sandboxes.has(mine.id)).toBe(true);
    expect((await work.list()).map((item) => item.id)).not.toContain(mine.id);
  });

  test("a different account name on the same provider key is still a different account", async () => {
    const personal = await clientFor("personal");
    const alias = await clientFor("alias");
    const mine = await personal.create({ name: "b", lifetimeMinutes: 10 });
    await expect(alias.get({ ...mine, account: "alias" })).rejects.toThrow(
      /not created by direct account "alias"/,
    );
    expect((await alias.list()).map((item) => item.id)).not.toContain(mine.id);
  });

  test("managed and direct references never cross", async () => {
    const personal = await clientFor("personal");
    const managedRef = {
      mode: "managed" as const,
      provider: "e2b" as const,
      account: "hosted",
      id: "x",
    };
    calls.length = 0;
    await expect(personal.get(managedRef)).rejects.toThrow(/managed account "hosted"/);
    expect(calls).toEqual([]);
  });

  test("invalid credentials fail clearly without switching modes or accounts", async () => {
    const broken = await clientFor("broken");
    const error = await broken.create({ name: "c", lifetimeMinutes: 10 }).catch((e) => e);
    expect(error).toBeInstanceOf(SandboxProviderError);
    expect(error.code).toBe("auth");
    expect(error.message).not.toContain("wrong");
    // Only the selected account's key was tried.
    expect(calls.filter((call) => call.startsWith("auth:") && call !== "auth:wrong")).toEqual([]);
    expect(() => createSandboxBackend(settings, "empty")).toThrow(/no E2B credential/);
    expect(() => createSandboxBackend(settings, "missing")).toThrow(/not configured/);
    expect(() => createSandboxBackend({ accounts: {} })).toThrow(/No sandbox accounts/);
  });

  test("direct mode needs no Gitterm login", async () => {
    const saved = { token: process.env.GITTERM_API_TOKEN, home: process.env.HOME };
    delete process.env.GITTERM_API_TOKEN;
    process.env.HOME = await mkdtemp(path.join(tmpdir(), "gitterm-nohome-"));
    try {
      const personal = await clientFor("personal");
      const created = await personal.create({ name: "d", lifetimeMinutes: 10 });
      expect(created.mode).toBe("direct");
      expect(describeSandboxAccount(settings, "personal")).toMatchObject({
        mode: "direct",
        credentialSource: "plugin option",
        credentialPresent: true,
      });
      expect(JSON.stringify(describeSandboxAccount(settings, "personal"))).not.toContain(
        "key-team-1",
      );
    } finally {
      process.env.GITTERM_API_TOKEN = saved.token;
      process.env.HOME = saved.home;
    }
  });

  test("a sandbox is deleted when setup fails after the provider created it", async () => {
    const before = new Set(sandboxes.keys());
    failSetup = true;
    try {
      const work = await clientFor("work");
      await expect(work.create({ name: "g", lifetimeMinutes: 10 })).rejects.toThrow(
        /prepare the sandbox/,
      );
    } finally {
      failSetup = false;
    }
    expect([...sandboxes.keys()].filter((id) => !before.has(id))).toEqual([]);
  });

  test("limits cap concurrency and lifetime", async () => {
    const work = createSandboxClient({
      backend: createSandboxBackend(settings, "work"),
      store: createFileSandboxStore(await mkdtemp(path.join(tmpdir(), "gitterm-store-"))),
      limits: { maxSandboxes: 1, maxLifetimeMinutes: 15 },
    });
    await expect(work.create({ name: "e", lifetimeMinutes: 16 })).rejects.toThrow(/approved limit/);
    for (const item of await work.list()) await work.destroy(item);
    await work.create({ name: "e", lifetimeMinutes: 15 });
    await expect(work.create({ name: "f", lifetimeMinutes: 5 })).rejects.toThrow(
      /approved limit is 1/,
    );
  });
});

describe("providers without labels or expiry", () => {
  const { createDirectSandboxBackend } = backendModule;
  const fakeTransport = (provider: "boat" | "exedev", expiry: "archive" | "none") => {
    const boxes = new Map<string, Record<string, string>>();
    return {
      provider,
      home: "/home/user",
      capabilities: {
        expiry,
        previews: "private" as const,
        pause: "stateful" as const,
        maxLifetimeMs: 86_400_000,
      },
      async create(input: { labels: Record<string, string> }) {
        // Like Boat and exe.dev: only a hash of the account survives, in the name.
        const id = `box${boxes.size}`;
        boxes.set(id, {
          gitterm_account_hash: accountHash(input.labels.gitterm_account!),
          gitterm_workload: "sandbox",
        });
        return {
          id,
          state: "running" as const,
          labels: boxes.get(id)!,
          startedAt: null,
          expiresAt: null,
        };
      },
      async info(id: string) {
        const labels = boxes.get(id);
        return labels
          ? { id, state: "running" as const, labels, startedAt: null, expiresAt: null }
          : { id, state: "terminated" as const, labels: {}, startedAt: null, expiresAt: null };
      },
      async list() {
        return [];
      },
      async destroy(id: string) {
        boxes.delete(id);
      },
      pause: async () => {},
      resume: async () => {},
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      writeFile: async () => {},
      readFile: async () => new Uint8Array(),
      preview: async () => ({ url: "https://x", headers: {} }),
    };
  };

  test("ownership survives as a hashed account name", async () => {
    const transport = fakeTransport("boat", "archive");
    const mine = createDirectSandboxBackend({ account: "personal", transport });
    const other = createDirectSandboxBackend({ account: "work", transport });
    const created = await mine.create({
      name: "x",
      lifetimeMs: 600_000,
      labels: {},
      publicPreviews: false,
    });
    expect((await mine.get(created.id)).state).toBe("running");
    await expect(other.get(created.id)).rejects.toThrow(/not created by direct account "work"/);
  });

  test("a provider that never deletes sandboxes needs explicit consent", async () => {
    const transport = fakeTransport("exedev", "none");
    const refused = createDirectSandboxBackend({ account: "personal", transport });
    await expect(
      refused.create({ name: "x", lifetimeMs: 600_000, labels: {}, publicPreviews: false }),
    ).rejects.toThrow(/allowUnboundedLifetime/);
    const allowed = createDirectSandboxBackend({
      account: "personal",
      transport,
      allowUnboundedLifetime: true,
    });
    expect(
      (await allowed.create({ name: "x", lifetimeMs: 600_000, labels: {}, publicPreviews: false }))
        .state,
    ).toBe("running");
  });
});

describe("source snapshots", () => {
  test("glob exclusions", () => {
    expect(globToRegExp("*.log").test("a/b/build.log")).toBe(true);
    expect(globToRegExp("fixtures/**").test("fixtures/x/y")).toBe(true);
    expect(globToRegExp("fixtures/*").test("fixtures/x/y")).toBe(false);
  });

  test("captures deletions, binaries, executables, and excludes secrets", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "gitterm-src-"));
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
      git("init", "-q");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "T");
      await writeFile(path.join(repo, "keep.txt"), "keep\n");
      await writeFile(path.join(repo, "gone.txt"), "gone\n");
      git("add", ".");
      git("commit", "-qm", "init");
      await rm(path.join(repo, "gone.txt"));
      await writeFile(path.join(repo, "bin.dat"), Buffer.from([0, 255, 1, 254]));
      await writeFile(path.join(repo, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
      await writeFile(path.join(repo, "server.pem"), "x");
      await writeFile(path.join(repo, "notes.txt"), "-----BEGIN OPENSSH PRIVATE KEY-----\n");
      const { snapshot, archive } = await captureSource(repo, { exclude: ["*.dat"] });
      expect(snapshot.files.map((file) => [file.path, file.kind])).toEqual([
        ["keep.txt", "file"],
        ["run.sh", "executable"],
      ]);
      expect(snapshot.deleted).toEqual(["gone.txt"]);
      expect(snapshot.excluded.map((item) => `${item.path}:${item.reason}`).toSorted()).toEqual([
        "bin.dat:excluded by configuration",
        "notes.txt:contains private key material",
        "server.pem:secret-like file name",
      ]);
      // Same tree, same digest.
      expect((await captureSource(repo, { exclude: ["*.dat"] })).snapshot.digest).toBe(
        snapshot.digest,
      );
      expect(archive.byteLength).toBeGreaterThan(0);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("tar archives extract with the system tar, including long names and binary data", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gitterm-tar-"));
    try {
      const long = `${"nested/".repeat(20)}file-é.txt`;
      const binary = Buffer.from([0, 1, 2, 255, 254, 10, 13]);
      await writeFile(
        path.join(directory, "a.tgz"),
        createTarGz([
          { path: long, type: "file", data: Buffer.from("long"), executable: false },
          { path: "bin/tool", type: "file", data: binary, executable: true },
          { path: "link", type: "symlink", target: "bin/tool" },
        ]),
      );
      execFileSync("mkdir", ["out"], { cwd: directory });
      execFileSync("tar", ["-xzf", "a.tgz", "-C", "out"], { cwd: directory });
      expect(await readFile(path.join(directory, "out", long), "utf8")).toBe("long");
      expect(Buffer.compare(await readFile(path.join(directory, "out/bin/tool")), binary)).toBe(0);
      expect(await readFile(path.join(directory, "out/link"))).toEqual(binary);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
