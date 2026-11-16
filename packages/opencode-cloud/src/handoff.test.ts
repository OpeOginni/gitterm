import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenCodeClient } from "@opencode/client";
import { GittermError, type GittermClient } from "@gitterm/sdk";
import {
  changePrompt,
  CONTINUE_TEXT,
  handoffSession,
  HandoffCancelled,
  sessionBusy,
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

type Inbox = Awaited<ReturnType<OpenCodeClient["session"]["inbox"]["list"]>>;
type Jobs = Awaited<ReturnType<OpenCodeClient["experimental"]["job"]["list"]>>;

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
  /** Notes sent to the local session, such as "continue where you left off". */
  const notes: Array<{ text: string; resume?: boolean | null }> = [];
  const local = {
    experimental: { job: { list: async (): Promise<Jobs> => [] } },
    session: {
      active: async () => ({}),
      get: async () => session,
      inbox: { list: async (): Promise<Inbox> => [] },
      interrupt: async () => ({ interrupted: true }),
      synthetic: async (input: (typeof notes)[number]) => {
        notes.push(input);
        return {};
      },
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
  const discarded: HandoffRecord[] = [];
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
      models: async () => ({ providers: [] }),
      terminate: async () => {
        terminates++;
      },
    },
  } as unknown as GittermClient;
  return {
    local,
    gitterm,
    forms,
    notes,
    records,
    discarded,
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
      discard: async (record: HandoffRecord) => {
        discarded.push({ ...record });
      },
      progress: async (_step: string) => {},
    },
  };
}

/** A cloud OpenCode: records what it is sent. `restoreExits` are the restore script's exit codes. */
function cloudServer(restoreExits: number[] = []) {
  const cloud = {
    requests: [] as string[],
    uploads: [] as Buffer[],
    prompts: [] as Array<{ text: string }>,
    notes: [] as Array<{ text: string; resume?: boolean; metadata?: unknown }>,
    entry: undefined as string | undefined,
  };
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const route = new URL(request.url).pathname;
      cloud.requests.push(route);
      expect(request.headers.get("authorization")).toBe(
        `Basic ${Buffer.from("opencode:password").toString("base64")}`,
      );
      if (route === "/api/info") return Response.json({ version: "2.3.0" });
      if (route === "/api/shell") {
        const { command } = (await request.json()) as { command: string };
        // The restore script is the only command that reads the uploaded snapshot.
        const exit = command.includes("snapshot.bin") ? (restoreExits.shift() ?? 0) : 0;
        return Response.json({
          location: { directory: root },
          data: { id: "shell", status: "exited", exit },
        });
      }
      if (route === "/api/experimental/fs/write") {
        cloud.uploads.push(Buffer.from(await request.arrayBuffer()));
        return Response.json({ location: { directory: root }, data: {} });
      }
      if (route === "/api/experimental/session/import") {
        const input = (await request.json()) as { info: { id: string } };
        return Response.json({ data: { ...input.info, location: { directory: root } } });
      }
      if (route.endsWith("/instructions/entries/gitterm-moved")) {
        cloud.entry = ((await request.json()) as { value: string }).value;
        return new Response(null, { status: 204 });
      }
      if (route.endsWith("/prompt")) {
        cloud.prompts.push((await request.json()) as { text: string });
        return Response.json({ data: {} });
      }
      if (route.endsWith("/synthetic")) {
        cloud.notes.push((await request.json()) as { text: string });
        return Response.json({ data: {} });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return cloud;
}

const manifest = (upload: Buffer) =>
  JSON.parse(upload.subarray(4, 4 + upload.readUInt32BE(0)).toString()) as {
    bundle: number;
    digest: string;
  };

test("prompts differ only by shared-checkout warning", () => {
  expect(changePrompt(0)).toBeUndefined();
  expect(changePrompt(2)).toContain("2 other active session(s)");
  expect(changePrompt(2)).toContain("Their changes may be included");
});

test("a clean checkout moves without a question and stores no credentials", async () => {
  const cloud = cloudServer();
  const f = fixture([]);
  const { record, continuing } = await handoffSession("ses_test", f.deps);
  expect(record.phase).toBe("ready");
  expect(continuing).toBe(false);
  expect(f.forms).toEqual([]);
  expect(f.records.map((item) => [item.phase, item.workspaceID])).toEqual([
    ["moving", undefined],
    ["moving", "workspace-test"],
    ["ready", "workspace-test"],
  ]);
  expect(cloud.requests.indexOf("/api/experimental/fs/write")).toBeLessThan(
    cloud.requests.indexOf("/api/experimental/session/import"),
  );
  expect(cloud.entry).toContain(`(local checkout ${await realpath(root)})`);
  // The same words sit in the conversation where the move happened, without starting the agent.
  expect(cloud.notes).toEqual([
    {
      text: `<session-moved source="gitterm">\nA notice from GitTerm, not a message from the user.\n${cloud.entry}\n</session-moved>`,
      resume: false,
      metadata: { source: "gitterm" },
    },
  ]);
  expect(cloud.prompts).toEqual([]);
  expect(JSON.stringify(f.records)).not.toContain("password");
  expect(f.terminates()).toBe(0);
});

test("uncommitted changes are asked about and go along when the user says so", async () => {
  await writeFile(path.join(root, "file.txt"), "local edit\n");
  const cloud = cloudServer();
  const f = fixture([{ changes: "yes" }]);
  expect((await handoffSession("ses_test", f.deps)).record.phase).toBe("ready");
  expect(f.forms.map((form) => (form.fields[0] as { title?: string }).title)).toEqual([
    "Bring your uncommitted changes to the cloud?",
  ]);
  expect(JSON.stringify(f.forms)).not.toContain('"default"');
  expect(cloud.uploads[0]!.toString("latin1")).toContain("local edit");
  expect(JSON.stringify(f.records)).not.toContain("local edit");
});

test("cancelling the question never provisions compute", async () => {
  await writeFile(path.join(root, "file.txt"), "local edit\n");
  const f = fixture(["cancelled"]);
  await expect(handoffSession("ses_test", f.deps)).rejects.toBeInstanceOf(HandoffCancelled);
  expect(f.creates()).toBe(0);
  expect(f.records).toEqual([]);
});

test("a running agent and its subagent are stopped here and continue in the cloud", async () => {
  const cloud = cloudServer();
  const f = fixture([]);
  // The parent runs and a subagent works in a child session. Stopping the child makes it
  // report back, which wakes the parent once more.
  const running = new Set(["ses_test", "ses_child"]);
  let wakes = 1;
  const interrupted: string[] = [];
  f.local.session.active = (async () =>
    Object.fromEntries([...running].map((id) => [id, {}]))) as typeof f.local.session.active;
  f.local.experimental.job.list = async () =>
    running.has("ses_child")
      ? ([
          {
            kind: "subagent",
            id: "job",
            sessionID: "ses_test",
            childSessionID: "ses_child",
            status: "running",
          },
        ] as unknown as Jobs)
      : [];
  f.local.session.interrupt = (async ({ sessionID }: { sessionID: string }) => {
    interrupted.push(sessionID);
    running.delete(sessionID);
    if (sessionID === "ses_child" && wakes-- > 0) running.add("ses_test");
    return { interrupted: true };
  }) as typeof f.local.session.interrupt;
  const steps: string[] = [];
  f.deps.progress = async (step) => {
    steps.push(step);
  };
  const { record, continuing } = await handoffSession("ses_test", f.deps);
  expect(record.phase).toBe("ready");
  expect(continuing).toBe(true);
  expect(steps[0]).toBe("Stopping the agent here");
  expect(interrupted.toSorted()).toEqual(["ses_child", "ses_test", "ses_test"]);
  expect(cloud.notes).toEqual([
    expect.objectContaining({ text: expect.stringContaining(cloud.entry!), resume: false }),
    expect.objectContaining({ text: CONTINUE_TEXT, resume: true }),
  ]);
  expect(f.notes).toEqual([]);
});

test("text after /cloud is sent to the cloud agent", async () => {
  const cloud = cloudServer();
  const f = fixture([]);
  const moved = await handoffSession("ses_test", f.deps, "finish the migration");
  expect(moved.continuing).toBe(true);
  expect(cloud.prompts).toEqual([expect.objectContaining({ text: "finish the migration" })]);
  expect(cloud.notes).toEqual([
    expect.objectContaining({ text: expect.stringContaining(cloud.entry!), resume: false }),
  ]);
});

test("running commands and messages waiting to be sent are refused before anything is asked", async () => {
  await writeFile(path.join(root, "file.txt"), "local edit\n");
  const shell = fixture([]);
  shell.local.experimental.job.list = async () =>
    [{ kind: "shell", id: "job", sessionID: "ses_test", status: "running" }] as unknown as Jobs;
  await expect(handoffSession("ses_test", shell.deps)).rejects.toThrow("background commands");
  const queued = fixture([]);
  queued.local.session.inbox.list = async () =>
    [{ id: "msg", type: "user", delivery: "queue", payload: { text: "next" } }] as unknown as Inbox;
  await expect(handoffSession("ses_test", queued.deps)).rejects.toThrow("message waiting");
  expect(shell.forms).toEqual([]);
  expect(queued.forms).toEqual([]);
  expect(shell.creates() + queued.creates()).toBe(0);
});

test("a !shell result waiting for the next prompt does not make a session busy", async () => {
  const f = fixture([]);
  const busy = async (item: unknown) => {
    f.local.session.inbox.list = async () => [item] as Inbox;
    return sessionBusy(f.local, "ses_test", f.deps.signal);
  };
  const synthetic = (source: string) => ({ type: "synthetic", payload: { metadata: { source } } });
  expect(await busy(synthetic("shell"))).toBe(false);
  // A subagent's report wakes the agent; a message starts it.
  expect(await busy(synthetic("subagent"))).toBe(true);
  expect(await busy({ type: "user", payload: { text: "next" } })).toBe(true);
});

test("sends the whole history when the cloud clone lacks the commits a smaller upload builds on", async () => {
  // HEAD is on origin's default branch, so the first upload carries no commits.
  await git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  await git(root, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  const cloud = cloudServer([3]);
  const f = fixture([]);
  expect((await handoffSession("ses_test", f.deps)).record.phase).toBe("ready");
  const uploads = cloud.uploads.map(manifest);
  expect(uploads.map((upload) => upload.bundle === 0)).toEqual([true, false]);
  expect(uploads[1]!.digest).toBe(uploads[0]!.digest);
  expect(f.creates()).toBe(1);
});

test("a repository GitTerm can't reach goes with its whole history instead", async () => {
  // HEAD is on origin's default branch, so a clone would need no commits from here.
  await git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  await git(root, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  const cloud = cloudServer();
  const f = fixture([]);
  f.deps.options = { connections: ["github", "mcp"] };
  const attempts: Array<{ repo?: string; connections?: string[]; idempotencyKey: string }> = [];
  f.gitterm.workspaces.create = (async (input: (typeof attempts)[number]) => {
    attempts.push(input);
    if (input.repo)
      throw new GittermError(
        "BAD_REQUEST",
        "Can't access repository. Configure Repository Access to use private repos (connect one in Integrations if needed).",
      );
    return { workspace: { id: "workspace-test", status: "running" } };
  }) as unknown as typeof f.gitterm.workspaces.create;
  expect((await handoffSession("ses_test", f.deps)).record.phase).toBe("ready");
  expect(attempts.map((attempt) => [attempt.repo, attempt.connections])).toEqual([
    ["https://github.com/example/repo.git", ["github", "mcp"]],
    [undefined, ["mcp"]],
  ]);
  expect(new Set(attempts.map((attempt) => attempt.idempotencyKey)).size).toBe(2);
  // One upload, and it carries the commits.
  expect(cloud.uploads.map((upload) => manifest(upload).bundle > 0)).toEqual([true]);
  expect(cloud.entry).toContain("copied without one");
});

test("other refusals are not retried without the repository", async () => {
  cloudServer();
  const f = fixture([]);
  let creates = 0;
  f.gitterm.workspaces.create = (async () => {
    creates++;
    throw new GittermError("FORBIDDEN", "You've reached your plan limit of 2 workspaces.");
  }) as unknown as typeof f.gitterm.workspaces.create;
  await expect(handoffSession("ses_test", f.deps)).rejects.toThrow("plan limit");
  expect(creates).toBe(1);
});

test("starts from the project snapshot, and fresh when that snapshot no longer starts", async () => {
  cloudServer();
  const run = async (outcome: "starts" | "fails" | "terminated") => {
    const attempts: Array<{ fresh: boolean; snapshot: boolean | undefined }> = [];
    const f = fixture([]);
    f.gitterm.workspaces.create = (async (input: {
      idempotencyKey: string;
      useProjectSnapshot?: boolean;
    }) => {
      attempts.push({
        fresh: input.idempotencyKey.endsWith(":fresh"),
        snapshot: input.useProjectSnapshot,
      });
      if (input.useProjectSnapshot && outcome === "fails")
        throw new GittermError(
          "SERVER_ERROR",
          "PROJECT_SNAPSHOT_FAILED: The project snapshot could not be started.",
        );
      const terminated = input.useProjectSnapshot && outcome === "terminated";
      return { workspace: { id: "workspace-test", status: terminated ? "terminated" : "running" } };
    }) as unknown as typeof f.gitterm.workspaces.create;
    expect((await handoffSession("ses_test", f.deps)).record.phase).toBe("ready");
    return attempts;
  };
  expect(await run("starts")).toEqual([{ fresh: false, snapshot: true }]);
  const fallback = [
    { fresh: false, snapshot: true },
    { fresh: true, snapshot: false },
  ];
  expect(await run("fails")).toEqual(fallback);
  expect(await run("terminated")).toEqual(fallback);
});

test("warns about another active session in a subdirectory of the same checkout", async () => {
  await mkdir(path.join(root, "nested"));
  await writeFile(path.join(root, "file.txt"), "local edit\n");
  const f = fixture(["cancelled"]);
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
});

test("a failed create says why, and the attempt is forgotten", async () => {
  const f = fixture([]);
  f.gitterm.workspaces.create = async () => {
    throw new GittermError(
      "SERVER_ERROR",
      "Gitterm couldn't start a small machine. Reference: ws1",
    );
  };
  const failure = handoffSession("ses_test", f.deps);
  await expect(failure).rejects.toThrow(
    "Moving to the cloud failed while creating the cloud workspace. Gitterm couldn't start a small machine. Reference: ws1 Local files",
  );
  expect(f.terminates()).toBe(0);
  expect(f.discarded.length).toBe(1);
});

test("a failure part way deletes the workspace and lets a stopped agent continue here", async () => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("secret upstream body", { status: 500 }),
  });
  const f = fixture([]);
  let running = true;
  f.local.session.active = (async () =>
    running ? { ses_test: {} } : {}) as typeof f.local.session.active;
  f.local.session.interrupt = (async () => {
    running = false;
    return { interrupted: true };
  }) as typeof f.local.session.interrupt;
  const failure = handoffSession("ses_test", f.deps);
  await expect(failure).rejects.toThrow(
    "Moving to the cloud failed while connecting to the cloud workspace. The cloud workspace was deleted.",
  );
  await expect(failure).rejects.not.toThrow("secret upstream body");
  expect(f.terminates()).toBe(1);
  expect(f.discarded.map((record) => record.workspaceID)).toEqual(["workspace-test"]);
  expect(f.notes).toEqual([expect.objectContaining({ resume: true })]);
});

test("cancelling part way deletes the workspace", async () => {
  cloudServer();
  const f = fixture([]);
  const cancel = new AbortController();
  f.deps.signal = cancel.signal;
  f.deps.progress = async (step) => {
    if (step === "Copying your code") cancel.abort();
  };
  await expect(handoffSession("ses_test", f.deps)).rejects.toBeInstanceOf(HandoffCancelled);
  expect(f.terminates()).toBe(1);
  expect(f.discarded.length).toBe(1);
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

test("envFiles become workspace variables without exposing names or values in the question", async () => {
  await writeFile(path.join(root, ".env"), "SHARED=from-env\nAPI_KEY=value-one\n");
  await writeFile(
    path.join(root, ".gitterm.env"),
    'SHARED=from-gitterm\nexport TOKEN="value two"\n',
  );
  const f = fixture([{ changes: "no" }]);
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
  const question = JSON.stringify(f.forms);
  for (const secret of ["SHARED", "API_KEY", "value-one", "from-env"])
    expect(question).not.toContain(secret);
});

test("a missing env file stops the handoff before anything is asked", async () => {
  const f = fixture([]);
  f.deps.options = { envFiles: [".gitterm.env"] };
  await expect(handoffSession("ses_test", f.deps)).rejects.toThrow(
    "Cannot read .gitterm.env from the envFiles setting.",
  );
  expect(f.forms).toEqual([]);
});
