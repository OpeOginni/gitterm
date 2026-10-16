import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenCodeClient } from "@opencode/client";
import type { GittermClient } from "@gitterm/sdk";
import {
  changePrompt,
  handoffSession,
  HandoffCancelled,
  importPayload,
  runtimeClient,
  showConnection,
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

function fixture(answers: Array<Record<string, boolean> | "cancelled">) {
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
  expect(changePrompt(0)).not.toContain("other active session");
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
  const f = fixture([{ changes: false }, { create: false }]);
  await expect(handoffSession("ses_test", f.deps)).rejects.toBeInstanceOf(HandoffCancelled);
  expect(f.creates()).toBe(0);
  expect(f.forms[0]?.fields[0]?.description).toContain("Local files remain unchanged");
  expect(f.forms[1]?.fields[0]?.description).toContain("Uncommitted changes are excluded");
});

test("a running source session is rejected, not interrupted", async () => {
  const f = fixture([]);
  f.local.session.active = async () => ({ ses_test: { type: "running" } });
  await expect(handoffSession("ses_test", f.deps)).rejects.toThrow("Stop this session");
  expect(f.creates()).toBe(0);
});

test("warns about another active session in a subdirectory of the same checkout", async () => {
  await mkdir(path.join(root, "nested"));
  const f = fixture([{ changes: false }, { create: false }]);
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
  let uploaded: { unstaged: string } | undefined;
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
        uploaded = (await request.json()) as { unstaged: string };
        return Response.json({ location: { directory: root }, data: {} });
      }
      if (route === "/api/experimental/session/import") {
        const input = (await request.json()) as { info: { id: string } };
        return Response.json({ data: { ...input.info, location: { directory: root } } });
      }
      if (route.endsWith("/synthetic")) return Response.json({ data: {} });
      return new Response("not found", { status: 404 });
    },
  });
  const f = fixture([{ changes: true }, { create: true }]);
  const record = await handoffSession("ses_test", f.deps);
  expect(record.phase).toBe("ready");
  expect(Buffer.from(uploaded!.unstaged, "base64").toString()).toContain("local edit");
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

test("failed transfer retains recovery metadata without terminating the cloud or touching local work", async () => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("secret upstream body", { status: 500 }),
  });
  const f = fixture([{ changes: false }, { create: true }]);
  await expect(handoffSession("ses_test", f.deps)).rejects.toThrow("workspace-test");
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
