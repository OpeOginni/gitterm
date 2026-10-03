import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { db } from "@gitterm/db";
import type { AgentRun } from "@gitterm/db/schema/agent-run";
import * as runtimes from "@gitterm/agent-runtime";
import { createAgentRun } from ".";
import * as targets from "./target";
import * as store from "./store";
import * as watchers from "./watcher";

afterEach(() => mock.restore());

test.each(["completed", "failed", "cancelled"] as const)(
  "%s before prompt acknowledgement preserves the workspace's only copy of output",
  async (status) => {
    const now = new Date();
    const row: AgentRun = {
      id: "run",
      workspaceId: "workspace",
      nativeSessionId: "session",
      nativeMessageId: "message",
      status: "running",
      title: "Agent run",
      pendingInputs: [],
      messages: [],
      finalText: null,
      errorMessage: null,
      parentRunId: null,
      createdAt: now,
      updatedAt: now,
      idempotencyKey: "key",
      requestHash: "hash",
      submittedAt: now,
      completedAt: null,
    };
    const target = { url: "https://workspace.example", directory: "/workspace", password: null };
    const workspace = { status: "running" } as targets.RunWorkspace;
    spyOn(targets, "getRunWorkspace").mockResolvedValue(workspace);
    spyOn(targets, "runtimeTargetFor").mockResolvedValue(target);
    spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    spyOn(db.query.agentRun, "findFirst").mockResolvedValue(undefined);
    spyOn(db, "insert").mockReturnValue({
      values: () => ({
        onConflictDoNothing: () => ({ returning: async () => [{ ...row, nativeSessionId: null }] }),
      }),
    } as any);
    spyOn(db, "update").mockReturnValue({
      set: () => ({ where: () => ({ returning: async () => [row] }) }),
    } as any);
    spyOn(store, "loadRun").mockImplementation(async () => row);
    spyOn(watchers, "ensureWorkspaceWatcher").mockResolvedValue({
      local: true,
      track: () => {},
      untrack: () => {},
      resolveInput: async () => {},
    });
    const abort = mock(async () => {});
    const deleteSession = mock(async () => {});
    spyOn(runtimes, "getRuntime").mockReturnValue({
      createSession: async () => ({ id: "session", title: "Agent run" }),
      prompt: async () => {
        row.status = status;
        row.completedAt = now;
      },
      abort,
      deleteSession,
    } as unknown as runtimes.OpencodeRuntime);

    const created = await createAgentRun(
      { workspaceId: "workspace", idempotencyKey: "key", prompt: "Finish quickly" },
      "user",
    );
    expect(created.status).toBe(status);
    expect(abort).toHaveBeenCalledTimes(status === "completed" ? 0 : 1);
    expect(deleteSession).not.toHaveBeenCalled();
  },
);
