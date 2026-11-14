import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenCodeClient } from "@opencode/client";
import { GittermError, type GittermClient } from "@gitterm/sdk";
import {
  changePrompt,
  handoffSession,
  HandoffCancelled,
  cloudHasModel,
  importPayload,
  offersModel,
  runtimeClient,
  showConnection,
  withoutGithub,
  type HandoffRecord,
} from "./handoff";
import { git } from "./snapshot";

let root: string;
let server: ReturnType<typeof Bun.serve> | undefined;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gitterm-orchestration-test-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Test"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["remote", "add", "origin", "https://github.com/example/repo.git"]);
  await writeFile(path.join(root, "file.txt"), "initial\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);
});
afterEach(async () => {
  server?.stop(true);
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

// What OpenCode answers when the cloud has no session of that ID.
const sessionNotFound = () =>
  Response.json(
    { _tag: "SessionNotFoundError", sessionID: "ses_test", message: "Session not found" },
    { status: 404 },
  );

function fixture(answers: Array<Record<string, boolean | string> | "cancelled">) {
  const forms: Array<{ title: string; fields: Array<{ description?: string }> }> = [];
  const session = {
    id: "ses_test",
    projectID: "project",
    title: "Local task",
    location: { directory: root },
    time: { created: 1, updated: 2 },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
  const local = {
    experimental: { job: { list: async () => [] } },
    session: {
      active: async () => ({}),
      get: async () => session,
      inbox: { list: async () => [] },
      export: async () => ({ info: session, messages: [] }),
      form: {
        create: async (input: (typeof forms)[number]) => {
          forms.push(input);
          return { id: "form" };
        },
        get: async () => {
          const answer = answers.shift();
          return {
            state:
              answer === "cancelled" ? { status: "cancelled" } : { status: "answered", answer },
          };
        },
        cancel: async () => {},
      },
    },
  } as unknown as OpenCodeClient;
  const records: HandoffRecord[] = [];
  let creates = 0;
  let terminates = 0;
  const gitterm = {
    workspaces: {
      create: async () => {
        creates++;
        return { workspace: { id: "workspace-test" } };
      },
      ensureRunning: async () => {},
      getRuntimeAccess: async () => ({
        url: `http://127.0.0.1:${server!.port}`,
        password: "password",
        directory: root,
      }),
      terminate: async () => {
        terminates++;
      },
    },
  } as unknown as GittermClient;
  return {
    local,
    gitterm,
    forms,
    records,
    creates: () => creates,
    terminates: () => terminates,
    deps: {
      local,
      gitterm,
      options: {},
      signal: AbortSignal.timeout(10_000),
      save: async (record: HandoffRecord) => {
        records.push({ ...record });
      },
      progress: async () => {},
    },
  };
}

test("prompts differ only by shared-checkout warning", () => {
  expect(changePrompt(0)).toBeUndefined();
  expect(changePrompt(2)).toContain("2 other active session(s)");
  expect(changePrompt(2)).toContain("Their changes may be included");
});

test("cancelled prompt never provisions compute", async () => {
  const f = fixture(["cancelled"]);
  await expect(handoffSession("ses_test", f.deps)).rejects.toBeInstanceOf(HandoffCancelled);
  expect(f.creates()).toBe(0);
  expect(f.records).toEqual([]);
});

test("declining billable upload never provisions compute", async () => {
  const f = fixture([{ changes: "no" }, { create: false }]);
  await expect(handoffSession("ses_test", f.deps)).rejects.toBeInstanceOf(HandoffCancelled);
  expect(f.creates()).toBe(0);
  expect(f.forms.map((form) => form.title)).toEqual([
    "Bring your uncommitted changes to the cloud?",
    "Start a cloud workspace for this session?",
  ]);
  expect(JSON.stringify(f.forms)).not.toContain('"default"');
});

test("a running source session is rejected, not interrupted", async () => {
  const f = fixture([]);
  f.local.session.active = async () => ({ ses_test: { type: "running" } });
  await expect(handoffSession("ses_test", f.deps)).rejects.toThrow("Stop this session");
  expect(f.creates()).toBe(0);
});

test("background jobs prevent handoff even when the source session is idle", async () => {
  const f = fixture([]);
  f.local.experimental.job.list = async (input) => {
    expect(input).toEqual({ sessionID: "ses_test", status: "running", descendants: true });
    return [
      {
        kind: "shell",
        id: "job_test",
        sessionID: "ses_test",
        status: "running",
        time: { started: 1 },
        shellID: "sh_test",
        command: "sleep 60",
      },
    ];
  };
  await expect(handoffSession("ses_test", f.deps)).rejects.toThrow("background jobs");
  expect(f.creates()).toBe(0);
});

test("warns about another active session in a subdirectory of the same checkout", async () => {
  await mkdir(path.join(root, "nested"));
  const f = fixture([{ changes: "no" }, { create: false }]);
  const get = f.local.session.get;
  f.local.session.active = async () => ({ ses_other: { type: "running" } });
  f.local.session.get = async (input) => {
    const session = await get(input);
    return input.sessionID === "ses_other"
      ? { ...session, id: "ses_other", location: { directory: path.join(root, "nested") } }
      : session;
  };
  await expect(handoffSession("ses_test", f.deps)).rejects.toBeInstanceOf(HandoffCancelled);
  expect(f.forms[0]?.fields[0]?.description).toContain("1 other active session(s)");
  expect(f.creates()).toBe(0);
});

test("restores before importing, records ready state, and never stores credentials or snapshot contents", async () => {
  await writeFile(path.join(root, "file.txt"), "local edit\n");
  const requests: string[] = [];
  let uploaded: Buffer | undefined;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const route = new URL(request.url).pathname;
      requests.push(route);
      expect(request.headers.get("authorization")).toBe(
        `Basic ${Buffer.from("opencode:password").toString("base64")}`,
      );
      if (route === "/api/info") return Response.json({ version: "2.0.30" });
      if (route === "/api/shell")
        return Response.json({
          location: { directory: root },
          data: { id: "shell", status: "exited", exit: 0 },
        });
      if (route === "/api/experimental/fs/write") {
        uploaded = Buffer.from(await request.arrayBuffer());
        return Response.json({ location: { directory: root }, data: {} });
      }
      if (route === "/api/experimental/session/import") {
        const input = (await request.json()) as { info: { id: string } };
        return Response.json({ data: { ...input.info, location: { directory: root } } });
      }
      if (route.endsWith("/synthetic")) return Response.json({ data: {} });
      if (route === "/api/experimental/session/ses_test/export") return sessionNotFound();
      return new Response("not found", { status: 404 });
    },
  });
  const f = fixture([{ changes: "yes" }, { create: true }]);
  const record = await handoffSession("ses_test", f.deps);
  expect(record.phase).toBe("ready");
  expect(uploaded!.toString("latin1")).toContain("local edit");
  expect(requests.indexOf("/api/experimental/fs/write")).toBeLessThan(
    requests.indexOf("/api/experimental/session/import"),
  );
  expect(f.records.map((item) => item.phase)).toEqual([
    "creating",
    "restoring",
    "importing",
    "ready",
  ]);
  expect(JSON.stringify(f.records)).not.toContain("password");
  expect(JSON.stringify(f.records)).not.toContain("local edit");
  expect(f.terminates()).toBe(0);
});

test("sends the whole history when the cloud clone lacks the commits a smaller upload builds on", async () => {
  // HEAD is on origin's default branch, so the first upload carries no commits.
  await git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  await git(root, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  // The upload starts with a 4-byte length and a JSON manifest; `bundle` is its byte count.
  const uploads: Array<{ bundle: number; digest: string }> = [];
  let restores = 0;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const route = new URL(request.url).pathname;
      if (route === "/api/info") return Response.json({ version: "2.0.30" });
      if (route === "/api/shell") {
        const { command } = (await request.json()) as { command: string };
        // The restore script is the only command that reads the uploaded snapshot.
        const exit = command.includes("snapshot.bin") && restores++ === 0 ? 3 : 0;
        return Response.json({
          location: { directory: root },
          data: { id: "shell", status: "exited", exit },
        });
      }
      if (route === "/api/experimental/fs/write") {
        const body = Buffer.from(await request.arrayBuffer());
        uploads.push(JSON.parse(body.subarray(4, 4 + body.readUInt32BE(0)).toString()));
        return Response.json({ location: { directory: root }, data: {} });
      }
      if (route === "/api/experimental/session/import") {
        const input = (await request.json()) as { info: { id: string } };
        return Response.json({ data: { ...input.info, location: { directory: root } } });
      }
      if (route.endsWith("/synthetic")) return Response.json({ data: {} });
      if (route === "/api/experimental/session/ses_test/export") return sessionNotFound();
      return new Response("not found", { status: 404 });
    },
  });
  const f = fixture([{ changes: "no" }, { create: true }]);
  const record = await handoffSession("ses_test", f.deps);
  expect(record.phase).toBe("ready");
  expect(uploads.map((upload) => upload.bundle === 0)).toEqual([true, false]);
  expect(uploads[1]!.digest).toBe(uploads[0]!.digest);
  expect(f.creates()).toBe(1);
});

/** A cloud OpenCode that keeps one session, so a retry meets what the earlier attempt left. */
type CloudSession = { info: Record<string, unknown>; messages: unknown[] };
function cloudWithSession() {
  const cloud = {
    session: undefined as CloudSession | undefined,
    requests: [] as string[],
    /** Input waiting in the session, as OpenCode's inbox lists it. */
    inbox: [] as unknown[],
    active: false,
    failImports: 0,
    failExports: 0,
  };
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const route = new URL(request.url).pathname;
      cloud.requests.push(`${request.method} ${route}`);
      if (route === "/api/info") return Response.json({ version: "2.0.30" });
      if (route === "/api/shell")
        return Response.json({
          location: { directory: root },
          data: { id: "shell", status: "exited", exit: 0 },
        });
      if (route === "/api/experimental/fs/write")
        return Response.json({ location: { directory: root }, data: {} });
      if (route === "/api/experimental/session/ses_test/export") {
        if (cloud.failExports-- > 0) return new Response("broken", { status: 500 });
        return cloud.session
          ? Response.json({ data: structuredClone(cloud.session) })
          : sessionNotFound();
      }
      if (route === "/api/session/ses_test/inbox") return Response.json({ data: cloud.inbox });
      if (route === "/api/session/active")
        return Response.json({ data: cloud.active ? { ses_test: {} } : {} });
      if (route === "/api/experimental/job") return Response.json({ data: [] });
      if (request.method === "DELETE" && route === "/api/session/ses_test") {
        cloud.session = undefined;
        cloud.inbox = [];
        return new Response(null, { status: 204 });
      }
      if (route === "/api/experimental/session/import") {
        if (cloud.failImports-- > 0) return new Response("broken", { status: 500 });
        if (cloud.session) return Response.json({ message: "exists" }, { status: 409 });
        const input = (await request.json()) as CloudSession;
        cloud.session = { info: input.info, messages: input.messages };
        return Response.json({ data: input.info });
      }
      if (route.endsWith("/synthetic")) {
        const input = (await request.json()) as { text: string; metadata?: unknown };
        cloud.inbox.push({
          id: `msg_note_${cloud.inbox.length}`,
          type: "synthetic",
          payload: { text: input.text, metadata: input.metadata },
        });
        return Response.json({ data: {} });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return cloud;
}

const message = (id: string, text: string) => ({ id, time: { created: 1 }, text, type: "user" });

/** Runs an attempt that imports the session and then fails, and returns what retries need. */
async function failAfterImport() {
  const cloud = cloudWithSession();
  const f = fixture([{ changes: "no" }, { create: true }, { changes: "no" }, { create: true }]);
  const local = { messages: [message("msg_1", "one")] };
  const get = f.local.session.get;
  f.local.session.export = (async (input: { sessionID: string }) => ({
    info: await get(input),
    messages: local.messages,
  })) as typeof f.local.session.export;
  const keys: string[] = [];
  f.gitterm.workspaces.create = (async (input: { idempotencyKey: string }) => {
    keys.push(input.idempotencyKey);
    return { workspace: { id: "workspace-test" } };
  }) as unknown as typeof f.gitterm.workspaces.create;
  // Everything reaches the cloud, then the last local save fails.
  const save = f.deps.save;
  let failSave = true;
  f.deps.save = async (record) => {
    if (record.phase === "ready" && failSave) throw new Error("disk full");
    await save(record);
  };
  await expect(handoffSession("ses_test", f.deps, "1111-aaaa")).rejects.toThrow();
  expect(cloud.session?.messages).toEqual(local.messages);
  // The attempt's own note is waiting in the cloud session.
  expect(cloud.inbox.length).toBe(1);
  failSave = false;
  cloud.requests.length = 0;
  return { cloud, f, local, keys, retry: () => handoffSession("ses_test", f.deps, "1111-aaaa") };
}

test("a retry uses the same workspace and replaces the session it imported with newer history", async () => {
  const { cloud, local, keys, retry } = await failAfterImport();
  local.messages = [message("msg_1", "one"), message("msg_2", "two")];
  expect(await retry()).toMatchObject({ attemptID: "1111-aaaa", phase: "ready" });
  expect(keys).toEqual(["opencode-handoff:1111-aaaa", "opencode-handoff:1111-aaaa"]);
  expect(cloud.session?.messages).toEqual(local.messages);
  const removed = cloud.requests.indexOf("DELETE /api/session/ses_test");
  expect(removed).toBeGreaterThan(-1);
  expect(cloud.requests.indexOf("POST /api/experimental/session/import")).toBeGreaterThan(removed);
  // Two shell commands on the way: make the upload directory, run the restore.
  expect(cloud.requests.filter((request) => request === "POST /api/shell").length).toBe(2);
});

test("a retry leaves a cloud session that has moved on since the earlier import", async () => {
  const { cloud, retry } = await failAfterImport();
  cloud.session!.messages.push(message("msg_cloud", "asked in the cloud"));
  await expect(retry()).rejects.toThrow("The cloud session has new activity");
  expect(cloud.requests).not.toContain("DELETE /api/session/ses_test");
  expect(cloud.session?.messages.at(-1)).toEqual(message("msg_cloud", "asked in the cloud"));
  // Refused before anything was uploaded or run: the cloud checkout is as it was.
  expect(cloud.requests).not.toContain("POST /api/shell");
  expect(cloud.requests).not.toContain("POST /api/experimental/fs/write");
});

test("a retry leaves a cloud session that has a prompt queued", async () => {
  const { cloud, retry } = await failAfterImport();
  const queued = { id: "msg_queued", type: "user", payload: { text: "asked in the cloud" } };
  cloud.inbox.push(queued);
  await expect(retry()).rejects.toThrow("The cloud session has new activity");
  expect(cloud.inbox).toContainEqual(queued);
  expect(cloud.requests).not.toContain("DELETE /api/session/ses_test");
  expect(cloud.requests).not.toContain("POST /api/shell");
});

test("a retry that cannot read the cloud session stops before touching the cloud", async () => {
  const { cloud, retry } = await failAfterImport();
  const queued = { id: "msg_queued", type: "user", payload: { text: "asked in the cloud" } };
  cloud.inbox.push(queued);
  cloud.failExports = 1;
  await expect(retry()).rejects.toThrow("Cloud handoff failed while restoring");
  expect(cloud.inbox).toContainEqual(queued);
  expect(cloud.requests).not.toContain("POST /api/shell");
  expect(cloud.requests).not.toContain("POST /api/experimental/session/import");
});

test("a retry leaves a cloud session whose agent is running", async () => {
  const { cloud, retry } = await failAfterImport();
  cloud.active = true;
  await expect(retry()).rejects.toThrow("The cloud session has new activity");
  expect(cloud.requests).not.toContain("DELETE /api/session/ses_test");
  expect(cloud.requests).not.toContain("POST /api/shell");
});

test("a retry whose import fails puts the earlier cloud session back", async () => {
  const { cloud, local, retry } = await failAfterImport();
  const earlier = structuredClone(cloud.session);
  local.messages = [message("msg_1", "one"), message("msg_2", "two")];
  cloud.failImports = 1;
  await expect(retry()).rejects.toThrow();
  expect(cloud.session).toEqual(earlier);
});

test("starts from the project snapshot, and fresh when that snapshot no longer starts", async () => {
  cloudWithSession();
  const attempts: Array<{ key: string; snapshot: boolean | undefined }> = [];
  const run = async (outcome: "starts" | "fails" | "failed earlier") => {
    attempts.length = 0;
    const f = fixture([{ changes: "no" }, { create: true }]);
    f.gitterm.workspaces.create = (async (input: {
      idempotencyKey: string;
      useProjectSnapshot?: boolean;
    }) => {
      attempts.push({ key: input.idempotencyKey, snapshot: input.useProjectSnapshot });
      if (input.useProjectSnapshot && outcome === "fails")
        throw new GittermError(
          "SERVER_ERROR",
          "PROJECT_SNAPSHOT_FAILED: The project snapshot could not be started.",
        );
      // A retry of an attempt whose snapshot start failed is answered with that workspace.
      const terminated = input.useProjectSnapshot && outcome === "failed earlier";
      return { workspace: { id: "workspace-test", status: terminated ? "terminated" : "running" } };
    }) as unknown as typeof f.gitterm.workspaces.create;
    expect((await handoffSession("ses_test", f.deps, "1111-aaaa")).phase).toBe("ready");
    return [...attempts];
  };
  expect(await run("starts")).toEqual([{ key: "opencode-handoff:1111-aaaa", snapshot: true }]);
  const fallback = [
    { key: "opencode-handoff:1111-aaaa", snapshot: true },
    { key: "opencode-handoff:1111-aaaa:fresh", snapshot: false },
  ];
  expect(await run("fails")).toEqual(fallback);
  expect(await run("failed earlier")).toEqual(fallback);
});

test("a failed create says which step failed and GitTerm's reason", async () => {
  const f = fixture([{ changes: "no" }, { create: true }]);
  f.gitterm.workspaces.create = async () => {
    throw new GittermError(
      "SERVER_ERROR",
      "Gitterm couldn't start a small machine. Reference: ws1",
    );
  };
  const failure = handoffSession("ses_test", f.deps);
  await expect(failure).rejects.toThrow(
    "Cloud handoff failed while creating the cloud workspace (attempt",
  );
  await expect(failure).rejects.toThrow("Gitterm couldn't start a small machine. Reference: ws1");
  expect(f.records.at(-1)?.phase).toBe("failed");
});

test("failed transfer retains recovery metadata without terminating the cloud or touching local work", async () => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("secret upstream body", { status: 500 }),
  });
  const f = fixture([{ changes: "no" }, { create: true }]);
  const failure = handoffSession("ses_test", f.deps);
  await expect(failure).rejects.toThrow(
    "while restoring your checkout in the cloud for workspace workspace-test",
  );
  await expect(failure).rejects.not.toThrow("secret upstream body");
  expect(f.records.at(-1)?.phase).toBe("failed");
  expect(f.records.at(-1)?.workspaceID).toBe("workspace-test");
  expect(JSON.stringify(f.records)).not.toContain("secret upstream body");
  expect(f.terminates()).toBe(0);
});

test("import detaches parent/fork, local revert state, and local permission grants", () => {
  const input = {
    info: {
      id: "ses_test",
      parentID: "ses_parent",
      fork: {},
      permissions: [{ effect: "allow" }],
      revert: {},
      location: { directory: "/local" },
    },
    messages: [{ type: "user", text: "history" }],
  } as unknown as Parameters<typeof importPayload>[0];
  const output = importPayload(input, "/cloud");
  expect(output.info.parentID).toBeUndefined();
  expect(output.info.permissions).toBeUndefined();
  expect(output.info.revert).toBeUndefined();
  expect(output.location?.directory).toBe("/cloud");
  expect(output.messages).toEqual(input.messages);
});

test("refuses insecure cloud endpoints and missing credentials", () => {
  expect(() =>
    runtimeClient({ url: "http://cloud.example.com", password: "secret" } as Parameters<
      typeof runtimeClient
    >[0]),
  ).toThrow("HTTPS");
  expect(() =>
    runtimeClient({ url: "https://cloud.example.com" } as Parameters<typeof runtimeClient>[0]),
  ).toThrow("credential");
});

test("reconnect offers a fresh pairing link without creating compute or saving the code", async () => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      expect(new URL(request.url).pathname).toBe("/api/pair");
      return Response.json({ code: "one-time-code", expires_in: 300 });
    },
  });
  const f = fixture([{ done: true }]);
  const record: HandoffRecord = {
    attemptID: "attempt",
    sessionID: "ses_test",
    phase: "ready",
    workspaceID: "workspace-test",
    sourceDirectory: root,
    head: "head",
    includeChanges: true,
    sharedSessions: 0,
    createdAt: "now",
  };
  await showConnection(f.local, f.gitterm, record, f.deps.signal);
  expect((f.forms[0]?.fields[0] as { url: string } | undefined)?.url).toContain(
    "/auth/connect/one-time-code",
  );
  expect(f.creates()).toBe(0);
  expect(f.records).toEqual([]);
});

test("a model is kept when the cloud offers it, waiting for a catalog that is still loading", async () => {
  const model = { providerID: "openai", id: "gpt-5.2" };
  // What the cloud's catalog holds on each look: empty at start, then growing, then steady.
  const catalog = (pages: Array<Array<{ providerID: string; id: string }>>) => {
    let look = 0;
    const client = {
      model: { list: async () => ({ data: pages[Math.min(look++, pages.length - 1)] }) },
    } as unknown as OpenCodeClient;
    return { client, looks: () => look };
  };
  const other = { providerID: "opencode", id: "big-pickle" };
  const signal = AbortSignal.timeout(5_000);

  const loading = catalog([[], [other], [other, model]]);
  expect(await offersModel(loading.client, "/w", model, signal, 1)).toBe(true);
  expect(loading.looks()).toBe(3);

  // Not there once the catalog has stopped growing: a few unchanged looks, not the full wait.
  const without = catalog([[], [other]]);
  expect(await offersModel(without.client, "/w", model, signal, 1)).toBe(false);
  expect(without.looks()).toBe(6);

  // The model is left out of the import, so the cloud session uses the cloud's default.
  const exported = {
    info: { id: "ses_test", location: { directory: "/local" }, model },
    messages: [],
  } as unknown as Parameters<typeof importPayload>[0];
  expect(importPayload(exported, "/w").info).toHaveProperty("model");
  expect(importPayload(exported, "/w", { keepModel: false }).info).not.toHaveProperty("model");
});

test("a provider GitTerm gave the workspace credentials for keeps its model at once", async () => {
  const model = { providerID: "openai", id: "gpt-5.2" };
  let looks = 0;
  // A cloud whose catalog has not loaded anything yet.
  const remote = {
    model: {
      list: async () => {
        looks++;
        return { data: [] };
      },
    },
  } as unknown as OpenCodeClient;
  const gitterm = (providers: Array<{ provider: string; active: boolean }> | Error) =>
    ({
      workspaces: {
        models: async () => {
          if (providers instanceof Error) throw providers;
          return { providers };
        },
      },
    }) as unknown as GittermClient;
  const signal = AbortSignal.timeout(5_000);

  expect(
    await cloudHasModel(
      gitterm([{ provider: "openai", active: true }]),
      "w",
      remote,
      "/w",
      model,
      signal,
    ),
  ).toBe(true);
  expect(looks).toBe(0);
  // No session model: nothing to check.
  expect(await cloudHasModel(gitterm([]), "w", remote, "/w", undefined, signal)).toBe(true);

  // A disabled credential, or an older GitTerm, falls back to the catalog.
  const catalog = {
    model: { list: async () => ({ data: [{ providerID: "openai", id: "gpt-5.2" }] }) },
  } as unknown as OpenCodeClient;
  expect(
    await cloudHasModel(
      gitterm([{ provider: "openai", active: false }]),
      "w",
      catalog,
      "/w",
      model,
      signal,
    ),
  ).toBe(true);
  expect(
    await cloudHasModel(gitterm(new Error("old server")), "w", catalog, "/w", model, signal),
  ).toBe(true);
});

test("a workspace without a repository drops every reference to a GitHub connection", async () => {
  let lists = 0;
  const gitterm = (allowed: boolean) =>
    ({
      integrations: {
        connections: {
          list: async () => {
            lists++;
            if (!allowed) throw new Error("Missing scope integrations:read");
            return [
              { id: "github:shared", name: "GitHub (shared)" },
              { id: "6f1c0d1e-0000-4000-8000-000000000001", name: "google" },
            ];
          },
        },
      },
    }) as unknown as GittermClient;
  // Integration keys are decided without listing connections, so no extra scope is needed.
  expect(await withoutGithub(gitterm(false), ["GitHub", " github ", "mcp", "google"])).toEqual([
    "mcp",
    "google",
  ]);
  expect(lists).toBe(0);
  // A key wins over a GitHub connection of the same name, as on the server.
  expect(
    await withoutGithub(gitterm(true), [
      "google",
      "GITHUB (shared)",
      "github:shared",
      "6f1c0d1e-0000-4000-8000-000000000001",
      "linear",
    ]),
  ).toEqual(["google", "linear"]);
  // Without the scope, names are left for workspace creation to validate.
  expect(await withoutGithub(gitterm(false), ["linear"])).toEqual(["linear"]);
  expect(await withoutGithub(gitterm(true), undefined)).toBeUndefined();
});

test("envFiles become workspace variables, named but not shown in the confirmation", async () => {
  await writeFile(path.join(root, ".env"), "SHARED=from-env\nAPI_KEY=value-one\n");
  await writeFile(
    path.join(root, ".gitterm.env"),
    'SHARED=from-gitterm\nexport TOKEN="value two"\n',
  );
  const f = fixture([{ changes: "no" }, { create: true }]);
  f.deps.options = { envFiles: [".env", ".gitterm.env"] };
  let sent: Record<string, string> | undefined;
  f.gitterm.workspaces.create = (async (input: {
    environmentVariables?: Record<string, string>;
  }) => {
    sent = input.environmentVariables;
    throw new GittermError("SERVER_ERROR", "stop here");
  }) as unknown as typeof f.gitterm.workspaces.create;
  await expect(handoffSession("ses_test", f.deps)).rejects.toThrow("stop here");
  expect(sent).toEqual({ SHARED: "from-gitterm", API_KEY: "value-one", TOKEN: "value two" });
  const confirmation = JSON.stringify(f.forms.at(-1));
  expect(confirmation).toContain("Environment variables: SHARED, API_KEY, TOKEN");
  expect(confirmation).toContain("conversation and repository history");
  expect(confirmation).not.toContain("value");
});

test("a missing env file stops the handoff before anything is asked", async () => {
  const f = fixture([]);
  f.deps.options = { envFiles: [".gitterm.env"] };
  await expect(handoffSession("ses_test", f.deps)).rejects.toThrow(
    "Cannot read .gitterm.env from the envFiles setting.",
  );
  expect(f.forms).toEqual([]);
});
