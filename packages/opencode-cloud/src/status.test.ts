import { afterEach, expect, test } from "bun:test";
import type { OpenCodeClient } from "@opencode/client";
import { PASSIVE_REQUEST_HEADER, type GittermClient } from "@gitterm/sdk";
import type { HandoffRecord } from "./handoff";
import { CLOUD_KEY, type CloudStatus } from "./marker";
import { cloudStatus, watchCloudSessions } from "./status";

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
  server = undefined;
});

const record: HandoffRecord = {
  attemptID: "1111-aaaa",
  sessionID: "ses_test",
  phase: "ready",
  workspaceID: "workspace-test",
  sourceDirectory: "/checkout",
  head: "0".repeat(40),
  includeChanges: true,
  sharedSessions: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
};

/** A cloud OpenCode and the GitTerm workspace in front of it, both adjustable. */
function cloud() {
  const state = {
    workspace: "running" as "running" | "paused" | "terminated",
    active: false,
    permissions: 0,
    forms: 0,
    /** Requests that reached the workspace, and whether each was marked passive. */
    requests: [] as Array<{ route: string; passive: boolean }>,
    runtimeLookups: 0,
  };
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const route = new URL(request.url).pathname;
      state.requests.push({ route, passive: request.headers.has(PASSIVE_REQUEST_HEADER) });
      if (route === "/api/session/active")
        return Response.json({ data: state.active ? { ses_test: {} } : {} });
      if (route === "/api/session/ses_test/permission")
        return Response.json({ data: Array.from({ length: state.permissions }, () => ({})) });
      if (route === "/api/session/ses_test/form")
        return Response.json({ data: Array.from({ length: state.forms }, () => ({})) });
      return new Response("not found", { status: 404 });
    },
  });
  const gitterm = {
    workspaces: {
      get: async () => ({ id: "workspace-test", status: state.workspace }),
      getRuntimeAccess: async () => {
        state.runtimeLookups++;
        return { url: `http://127.0.0.1:${server!.port}`, password: "password", directory: "/w" };
      },
    },
  } as unknown as GittermClient;
  return { state, gitterm };
}

test("reads what the cloud session is doing, with every request marked passive", async () => {
  const { state, gitterm } = cloud();
  const signal = AbortSignal.timeout(5_000);
  expect(await cloudStatus(gitterm, record, signal)).toBe("idle");
  state.active = true;
  expect(await cloudStatus(gitterm, record, signal)).toBe("working");
  // An agent that asked a question is still running, but it is the user it waits for.
  state.forms = 1;
  expect(await cloudStatus(gitterm, record, signal)).toBe("waiting");
  state.forms = 0;
  state.permissions = 1;
  expect(await cloudStatus(gitterm, record, signal)).toBe("waiting");
  expect(state.requests.length).toBe(12);
  expect(state.requests.every((request) => request.passive)).toBe(true);
});

test("never reaches for a workspace that is not running", async () => {
  const { state, gitterm } = cloud();
  const signal = AbortSignal.timeout(5_000);
  state.workspace = "paused";
  expect(await cloudStatus(gitterm, record, signal)).toBe("paused");
  state.workspace = "terminated";
  expect(await cloudStatus(gitterm, record, signal)).toBe("gone");
  expect(state.requests).toEqual([]);
  expect(state.runtimeLookups).toBe(0);
});

test("keeps the session's marker in step, writing only when the status changes", async () => {
  const { state, gitterm } = cloud();
  const marks: Array<CloudStatus | undefined> = [];
  const local = {
    session: {
      get: async () => ({ metadata: { other: "kept" } }),
      update: async (input: { metadata: Record<string, { status?: CloudStatus }> }) => {
        expect(input.metadata.other as unknown).toBe("kept");
        marks.push(input.metadata[CLOUD_KEY]?.status);
      },
    },
  } as unknown as OpenCodeClient;
  const sessions = [record];
  const gone: string[] = [];
  let busy = false;
  // Each round of the watcher is followed by the next step of this script.
  const script = [
    () => {}, // idle again: nothing is written
    () => {
      state.active = true;
    },
    () => {
      busy = true; // a command is working on the session: it is left alone
      state.active = false;
    },
    () => {
      busy = false;
    },
    () => {
      state.workspace = "terminated";
    },
  ];
  await watchCloudSessions({
    gitterm: () => gitterm,
    local: async () => local,
    sessions: () => sessions,
    busy: () => busy,
    gone: async (item) => {
      gone.push(item.sessionID);
      sessions.length = 0; // no longer in the cloud, so the watcher stops
    },
    signal: AbortSignal.timeout(5_000),
    pause: async () => {
      script.shift()?.();
    },
  });
  expect(marks).toEqual(["idle", "working", "idle", "gone"]);
  expect(gone).toEqual(["ses_test"]);
});
