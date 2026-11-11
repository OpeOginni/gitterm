import { describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Built from parts so this file is not itself synced as a private key. */
const KEY_HEADER = (kind: string) => `-----BEGIN ${kind}PRIVATE ` + "KEY-----";

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

const { createSandboxBackend, describeSandboxAccount, resolveSandboxAccount } =
  await import("./config");
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
    personal: { provider: "e2b" as const, apiKey: "key-team-1" },
    // Same provider, same key, different account name.
    alias: { provider: "e2b" as const, apiKey: "key-team-1" },
    work: { provider: "e2b" as const, apiKey: "key-team-2" },
    broken: { provider: "e2b" as const, apiKey: "wrong" },
    empty: { provider: "e2b" as const, apiKey: "" },
    hosted: { serverUrl: "http://127.0.0.1:9", token: "gt_test" },
  },
};

const backendFor = async (account: string) =>
  createSandboxBackend(await resolveSandboxAccount(settings, account));

async function clientFor(account: string) {
  const store = createFileSandboxStore(await mkdtemp(path.join(tmpdir(), "gitterm-store-")));
  return createSandboxClient({
    backend: await backendFor(account),
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

  test("using a sandbox that no longer exists fails as not_found, so job watchers stop", async () => {
    const personal = await clientFor("personal");
    const mine = await personal.create({ name: "gone", lifetimeMinutes: 10 });
    sandboxes.delete(mine.id);
    expect((await personal.get(mine)).state).toBe("terminated");
    await expect(personal.exec(mine, { command: "true" })).rejects.toMatchObject({
      name: "SandboxProviderError",
      code: "not_found",
    });
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
    await expect(backendFor("empty")).rejects.toThrow(/no E2B credential/);
    await expect(backendFor("missing")).rejects.toThrow(/not configured/);
    await expect(resolveSandboxAccount({ accounts: {} })).rejects.toThrow(/No sandbox accounts/);
  });

  test("an own key needs no Gitterm login", async () => {
    const saved = { token: process.env.GITTERM_API_TOKEN, home: process.env.HOME };
    delete process.env.GITTERM_API_TOKEN;
    process.env.HOME = await mkdtemp(path.join(tmpdir(), "gitterm-nohome-"));
    try {
      const personal = await clientFor("personal");
      const created = await personal.create({ name: "d", lifetimeMinutes: 10 });
      expect(created.mode).toBe("direct");
      const account = await resolveSandboxAccount(settings, "personal");
      expect(describeSandboxAccount(account)).toMatchObject({
        mode: "direct",
        credentialSource: "plugin option",
        credentialPresent: true,
      });
      expect(JSON.stringify(describeSandboxAccount(account))).not.toContain("key-team-1");
      // One account inline, named after its provider.
      const inline = await resolveSandboxAccount({ provider: "e2b", apiKey: "key-team-1" });
      expect(inline).toMatchObject({ name: "e2b", provider: "e2b", ownKey: true });
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
      backend: await backendFor("work"),
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

describe("GitTerm accounts", () => {
  /** A GitTerm server that answers only `sandbox.providers`. */
  async function withServer(
    offered: { providers: string[]; default: string | null },
    run: (serverUrl: string) => Promise<void>,
  ) {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json([{ result: { data: offered } }]),
    });
    try {
      await run(`http://127.0.0.1:${server.port}`);
    } finally {
      server.stop(true);
    }
  }

  test("an account without a key uses the server's default provider", async () => {
    await withServer({ providers: ["daytona", "e2b"], default: "daytona" }, async (serverUrl) => {
      const account = await resolveSandboxAccount({ serverUrl, token: "gt_test", size: "large" });
      expect(account).toMatchObject({ name: "gitterm", provider: "daytona", ownKey: false });
      expect(describeSandboxAccount(account).chargedTo).toContain("Gitterm plan");
    });
  });

  test("a provider the server doesn't offer points at the forgotten key", async () => {
    await withServer({ providers: ["gitterm"], default: "gitterm" }, async (serverUrl) => {
      await expect(
        resolveSandboxAccount({ provider: "e2b", serverUrl, token: "gt_test" }),
      ).rejects.toThrow(/doesn't offer E2B .* add "apiKey" to sandbox account "e2b"/);
    });
  });

  test("several providers and no default asks for one", async () => {
    await withServer({ providers: ["daytona", "e2b"], default: null }, async (serverUrl) => {
      await expect(resolveSandboxAccount({ serverUrl, token: "gt_test" })).rejects.toThrow(
        /daytona, e2b sandboxes and no default. Set "provider"/,
      );
    });
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
        snapshots: "none" as const,
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

describe("paused managed sandboxes", () => {
  async function pausedClient(pause: "stateful" | "state-losing") {
    const identity = { mode: "managed" as const, provider: "e2b" as const, account: "hosted" };
    const sandbox = { state: "paused" as "paused" | "running", resumes: 0 };
    const backend = {
      identity,
      home: "/home/user",
      capabilities: { expiry: "idle" as const, previews: "private" as const, pause },
      get: async (id: string) => ({
        ...identity,
        id,
        state: sandbox.state,
        name: "s",
        createdAt: null,
        expiresAt: null,
        labels: {},
      }),
      resume: async () => {
        sandbox.resumes++;
        sandbox.state = "running";
      },
    } as unknown as Parameters<typeof createSandboxClient>[0]["backend"];
    const store = createFileSandboxStore(await mkdtemp(path.join(tmpdir(), "gitterm-store-")));
    const client = createSandboxClient({ backend, store });
    const ref = { ...identity, id: "sbx1" };
    await store.put({
      ...ref,
      name: "s",
      purpose: "",
      project: null,
      sessionId: null,
      state: "paused",
      publicPreviews: false,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      snapshot: { id: "snap", digest: "d", root: "/r", syncedAt: new Date().toISOString() },
      jobs: {},
      previews: {},
      updatedAt: new Date().toISOString(),
    });
    return { client, ref, sandbox, store };
  }

  test("are resumed on use instead of asking the agent to resume them", async () => {
    const { client, ref, sandbox } = await pausedClient("stateful");
    // Reaching the job lookup means the sandbox was resumed and accepted as running.
    await expect(client.job(ref, "missing")).rejects.toThrow(/Unknown job missing/);
    expect(sandbox.resumes).toBe(1);
  });

  test("a provider that discards files on pause asks for a new sync", async () => {
    const { client, ref, sandbox, store } = await pausedClient("state-losing");
    await expect(client.job(ref, "missing")).rejects.toThrow(/Sync again/);
    expect(sandbox.resumes).toBe(1);
    expect((await store.get(ref))?.snapshot).toBeNull();
  });

  test("an explicit resume also forgets files the provider discarded", async () => {
    const { client, ref, store } = await pausedClient("state-losing");
    expect((await client.resume(ref)).snapshot).toBeNull();
    expect((await store.get(ref))?.snapshot).toBeNull();
  });
});

test("a preview server is stopped with its sandbox, not at the job limit", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const identity = { mode: "direct" as const, provider: "e2b" as const, account: "a" };
  const runs: string[] = [];
  const backend = {
    identity,
    home: "/home/user",
    capabilities: {
      expiry: "hard" as const,
      previews: "either" as const,
      pause: "stateful" as const,
    },
    get: async (id: string) => ({
      ...identity,
      id,
      state: "running",
      name: "s",
      createdAt: null,
      expiresAt: null,
      labels: {},
    }),
    run: async (_id: string, command: string) => {
      runs.push(command);
      return { exitCode: 0, stdout: "started", stderr: "" };
    },
    writeFile: async () => {},
    readFile: async () => new Uint8Array(),
    preview: async () => ({ url: `http://localhost:${server.port}/`, headers: {} }),
  } as unknown as Parameters<typeof createSandboxClient>[0]["backend"];
  const store = createFileSandboxStore(await mkdtemp(path.join(tmpdir(), "gitterm-store-")));
  const ref = { ...identity, id: "sbx1" };
  const now = Date.now();
  await store.put({
    ...ref,
    name: "s",
    purpose: "",
    project: null,
    sessionId: null,
    state: "running",
    publicPreviews: false,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 120 * 60_000).toISOString(),
    snapshot: null,
    jobs: {},
    previews: {},
    updatedAt: new Date(now).toISOString(),
  });
  try {
    const client = createSandboxClient({ backend, store, limits: { maxJobMinutes: 30 } });
    const preview = await client.preview(ref, { port: 3000, command: "bun run dev" });
    const minutes = (await store.get(ref))!.jobs[preview.jobId!]!.timeoutMs / 60_000;
    expect(minutes).toBeGreaterThan(119);
    expect(minutes).toBeLessThanOrEqual(120);
    // Ordinary jobs keep the job limit.
    await expect(client.exec(ref, { command: "x", timeoutMinutes: 60 })).rejects.toThrow(
      /30 minutes/,
    );
  } finally {
    server.stop(true);
  }
});

describe("preview visibility", () => {
  async function previewOn(
    previews: "private" | "either",
    publicPreviews: boolean,
    viaGitterm = false,
  ) {
    const asked: unknown[] = [];
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const gittermUrl = viaGitterm ? `http://127.0.0.1:${server.port}/gitterm` : undefined;
    const identity = { mode: "direct" as const, provider: "boat" as const, account: "a" };
    const backend = {
      identity,
      home: "/home/user",
      capabilities: { expiry: "hard" as const, previews, pause: "stateful" as const },
      get: async (id: string) => ({
        ...identity,
        id,
        state: "running",
        name: "s",
        createdAt: null,
        expiresAt: null,
        labels: {},
      }),
      preview: async (_id: string, _port: number, options: unknown) => {
        asked.push(options);
        return { url: `http://localhost:${server.port}/`, headers: { token: "t" }, gittermUrl };
      },
    } as unknown as Parameters<typeof createSandboxClient>[0]["backend"];
    const store = createFileSandboxStore(await mkdtemp(path.join(tmpdir(), "gitterm-store-")));
    const ref = { ...identity, id: "sbx1" };
    await store.put({
      ...ref,
      name: "s",
      purpose: "",
      project: null,
      sessionId: null,
      state: "running",
      publicPreviews,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      snapshot: null,
      jobs: {},
      previews: {},
      updatedAt: new Date().toISOString(),
    });
    try {
      const preview = await createSandboxClient({ backend, store }).preview(ref, { port: 3000 });
      const stored = (await store.get(ref))!.previews["3000"]!;
      return gittermUrl
        ? { preview, stored, asked }
        : { reported: preview.public, stored: stored.public };
    } finally {
      server.stop(true);
    }
  }

  test("a provider without a public mode never reports a preview as public", async () => {
    expect(await previewOn("private", true)).toEqual({ reported: false, stored: false });
  });

  test("a preview served by Gitterm is the URL to open; direct access stays for proxies", async () => {
    const { preview, stored, asked } = (await previewOn("either", true, true)) as {
      preview: Awaited<ReturnType<ReturnType<typeof createSandboxClient>["preview"]>>;
      stored: { url: string };
      asked: unknown[];
    };
    expect(asked).toEqual([{ public: true }]);
    expect(preview).toMatchObject({
      public: true,
      viaGitterm: true,
      access: { headers: { token: "t" } },
    });
    expect(preview.url).toEndWith("/gitterm");
    expect(preview.access.url).toStartWith("http://localhost:");
    expect(stored.url).toBe(preview.url);
  });

  test("a provider that can do either follows the sandbox's choice", async () => {
    expect(await previewOn("either", true)).toEqual({ reported: true, stored: true });
    expect(await previewOn("either", false)).toEqual({ reported: false, stored: false });
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
      await writeFile(
        path.join(repo, "notes.txt"),
        `${KEY_HEADER("OPENSSH ")}\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n`,
      );
      await writeFile(
        path.join(repo, "service.json"),
        JSON.stringify({
          private_key: `${KEY_HEADER("")}\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n`,
        }),
      );
      // A key detector names the header but holds no key.
      await writeFile(
        path.join(repo, "detect.ts"),
        'export const hasKey = (s: string) => s.includes("-----BEGIN PRIVATE KEY-----");\n',
      );
      const { snapshot, archive } = await captureSource(repo, { exclude: ["*.dat"] });
      expect(snapshot.files.map((file) => [file.path, file.kind])).toEqual([
        ["detect.ts", "file"],
        ["keep.txt", "file"],
        ["run.sh", "executable"],
      ]);
      expect(snapshot.deleted).toEqual(["gone.txt"]);
      expect(snapshot.excluded.map((item) => `${item.path}:${item.reason}`).toSorted()).toEqual([
        "bin.dat:excluded by configuration",
        "notes.txt:contains private key material",
        "server.pem:secret-like file name",
        "service.json:contains private key material",
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
