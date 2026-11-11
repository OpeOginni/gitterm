import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenCodeClient } from "@opencode/client";
import { GittermError, type GittermClient } from "@gitterm/sdk";
import type { HandoffRecord } from "./handoff";
import { confirmLocalPrompt, finishReturn, returnSession } from "./return";
import { checkoutRoot, git } from "./snapshot";

let root: string;
let server: ReturnType<typeof Bun.serve> | undefined;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gitterm-return-test-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Test"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await writeFile(path.join(root, "file.txt"), "initial\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);
  root = await checkoutRoot(root);
});
afterEach(async () => {
  server?.stop(true);
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

const record = (): HandoffRecord => ({
  attemptID: "1111-aaaa",
  sessionID: "ses_test",
  phase: "ready",
  workspaceID: "workspace-test",
  sourceDirectory: root,
  head: "0".repeat(40),
  includeChanges: true,
  sharedSessions: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
});

/** A local OpenCode whose forms are answered with `answer`, or dismissed when it is undefined. */
function localWith(answer: Record<string, boolean> | undefined) {
  const forms: string[] = [];
  const client = {
    experimental: { job: { list: async () => [] } },
    session: {
      active: async () => ({}),
      get: async () => ({ id: "ses_test", location: { directory: root } }),
      inbox: { list: async () => [] },
      form: {
        create: async (input: { title: string }) => {
          forms.push(input.title);
          return { id: "form" };
        },
        get: async () => ({
          state: answer ? { status: "answered", answer } : { status: "cancelled" },
        }),
        cancel: async () => {},
      },
    },
  } as unknown as OpenCodeClient;
  return { client, forms };
}

test("a message in a cloud session is sent only when the user says so", async () => {
  const signal = AbortSignal.timeout(5_000);
  const yes = localWith({ send: true });
  await confirmLocalPrompt(yes.client, record(), signal);
  expect(yes.forms).toEqual(["This session is in the cloud. Send this message here anyway?"]);

  await expect(
    confirmLocalPrompt(localWith({ send: false }).client, record(), signal),
  ).rejects.toThrow("Not sent: this session continues in the cloud.");
  // Dismissing the question does not send the message either.
  await expect(confirmLocalPrompt(localWith(undefined).client, record(), signal)).rejects.toThrow(
    "Not sent",
  );
});

test("only a session that is in the cloud can be brought back", async () => {
  const deps = {
    local: localWith(undefined).client,
    gitterm: {} as GittermClient,
    signal: AbortSignal.timeout(5_000),
    save: async () => {},
    progress: async () => {},
  };
  await expect(returnSession({ ...record(), phase: "returned" }, deps)).rejects.toThrow(
    "This session is not in a cloud workspace.",
  );
  await expect(returnSession({ ...record(), sourceDirectory: "/elsewhere" }, deps)).rejects.toThrow(
    "no longer in the checkout it was handed off from",
  );
});

test("a cloud session that is still working is left alone, and nothing is captured", async () => {
  const requests: string[] = [];
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const route = new URL(request.url).pathname;
      requests.push(`${request.method} ${route}`);
      if (route === "/api/experimental/job") return Response.json({ data: [] });
      if (route === "/api/session/active") return Response.json({ data: {} });
      // A prompt someone queued in the cloud.
      if (route === "/api/session/ses_test/inbox")
        return Response.json({
          data: [{ id: "msg_queued", type: "user", payload: { text: "keep going" } }],
        });
      return new Response("not found", { status: 404 });
    },
  });
  const saved: HandoffRecord[] = [];
  const failure = returnSession(record(), {
    local: localWith(undefined).client,
    gitterm: {
      workspaces: {
        ensureRunning: async () => {},
        getRuntimeAccess: async () => ({
          url: `http://127.0.0.1:${server!.port}`,
          password: "password",
          directory: root,
        }),
      },
    } as unknown as GittermClient,
    signal: AbortSignal.timeout(5_000),
    save: async (item) => {
      saved.push(item);
    },
    progress: async () => {},
  });
  await expect(failure).rejects.toThrow("The cloud session is still working or has queued input.");
  expect(requests).not.toContain("POST /api/shell");
  expect(saved).toEqual([]);
});

/** A GitTerm whose workspace may or may not be kept as a snapshot; records what was asked of it. */
function gittermWith(snapshot: { available: boolean; existing?: boolean } | "unknown") {
  const calls: string[] = [];
  let failSave = false;
  const client = {
    workspaces: {
      projectSnapshot: async () => {
        if (snapshot === "unknown") throw new Error("an older GitTerm server");
        return {
          available: snapshot.available,
          existing: snapshot.existing
            ? { id: "snap", createdAt: "2026-10-01T00:00:00.000Z" }
            : null,
        };
      },
      pause: async () => {
        calls.push("pause");
      },
      terminate: async (_id: string, options?: { saveSnapshot?: boolean }) => {
        if (options?.saveSnapshot && failSave)
          throw new GittermError("SERVER_ERROR", "The provider refused the snapshot.");
        calls.push(options?.saveSnapshot ? "delete, keeping a snapshot" : "delete");
      },
    },
  } as unknown as GittermClient;
  return {
    client,
    calls,
    failSaves: () => {
      failSave = true;
    },
  };
}
const kept = { stash: false, branch: null, sessionID: null };
const finish = (
  gitterm: GittermClient,
  answer: Record<string, boolean> | undefined,
  forms: string[] = [],
) => {
  const local = localWith(answer);
  return finishReturn(
    local.client,
    gitterm,
    { ...record(), phase: "returned" },
    kept,
    signal(),
  ).then(() => forms.push(...local.forms));
};
const signal = () => AbortSignal.timeout(5_000);

test("a workspace that cannot be kept as a snapshot is deleted, or paused on request", async () => {
  for (const snapshot of [{ available: false }, "unknown"] as const) {
    const forms: string[] = [];
    const yes = gittermWith(snapshot);
    await finish(yes.client, { remove: true }, forms);
    expect(forms).toEqual(["Back on this machine. Delete the cloud workspace?"]);
    expect(yes.calls).toEqual(["delete"]);

    const no = gittermWith(snapshot);
    await finish(no.client, { remove: false });
    expect(no.calls).toEqual(["pause"]);
  }
});

test("where a snapshot can be kept, the one question decides it and the workspace is deleted", async () => {
  const forms: string[] = [];
  const first = gittermWith({ available: true });
  await finish(first.client, { keep: true }, forms);
  expect(first.calls).toEqual(["delete, keeping a snapshot"]);

  const again = gittermWith({ available: true, existing: true });
  await finish(again.client, { keep: false }, forms);
  expect(again.calls).toEqual(["delete"]);
  expect(forms).toEqual([
    "Back on this machine. Keep a snapshot for this project's next cloud session?",
    "Back on this machine. Update this project's cloud snapshot?",
  ]);

  // Dismissing the question deletes nothing.
  const dismissed = gittermWith({ available: true });
  await finish(dismissed.client, undefined);
  expect(dismissed.calls).toEqual(["pause"]);
});

test("a snapshot that cannot be saved still ends the workspace, and says so", async () => {
  const gitterm = gittermWith({ available: true });
  gitterm.failSaves();
  await expect(finish(gitterm.client, { keep: true })).rejects.toThrow(
    "its snapshot could not be saved. The provider refused the snapshot.",
  );
  expect(gitterm.calls).toEqual(["delete"]);
});
