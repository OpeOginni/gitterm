import { expect, spyOn, test } from "bun:test";
import { db } from "@gitterm/db";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { TRPCError } from "@trpc/server";
import { t } from "../../index";
import type { Context } from "../../context";
import { WorkspaceLifecycleTRPCError } from "../../utils/workspace-lifecycle-error";
import { createAgentRun } from ".";
import { runtimeTargetFor, type RunWorkspace } from "./target";

type ErrorResponse = {
  error: {
    message: string;
    data: { code: string; workspaceLifecycleCode: string | null };
  };
};

test.each([
  ["paused", "WORKSPACE_NOT_RUNNING", "BAD_REQUEST"],
  ["terminated", "WORKSPACE_TERMINATED", "BAD_REQUEST"],
  ["pending", "WORKSPACE_START_TIMEOUT", "TIMEOUT"],
] as const)("run creation on %s emits %s", async (status, appCode, transportCode) => {
  const workspace = spyOn(db.query.workspace, "findFirst").mockResolvedValue({ status } as never);
  const existingRun = spyOn(db.query.agentRun, "findFirst").mockResolvedValue(undefined);
  try {
    const error = await createAgentRun(
      {
        workspaceId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        prompt: "hello",
        startTimeoutMs: 0,
      },
      "user-test",
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorkspaceLifecycleTRPCError);
    expect((error as WorkspaceLifecycleTRPCError).workspaceLifecycleCode).toBe(appCode);
    expect((error as TRPCError).code).toBe(transportCode);
    expect((error as Error).message.startsWith(`${appCode}:`)).toBe(true);
  } finally {
    workspace.mockRestore();
    existingRun.mockRestore();
  }
});

test("runtime access rejects a paused workspace with a lifecycle code", async () => {
  const error = await runtimeTargetFor({ status: "paused" } as RunWorkspace).catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(WorkspaceLifecycleTRPCError);
  expect((error as WorkspaceLifecycleTRPCError).workspaceLifecycleCode).toBe(
    "WORKSPACE_NOT_RUNNING",
  );
});

test("tRPC serializes the lifecycle code independently of the English message", async () => {
  const error = new WorkspaceLifecycleTRPCError("WORKSPACE_NOT_RUNNING", "workspace is paused");
  error.message = "Workspace must be running";
  const router = t.router({
    fail: t.procedure.query(() => {
      throw error;
    }),
  });
  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    req: new Request("http://localhost/trpc/fail"),
    router,
    createContext: async () => ({}) as Context,
  });
  expect(response.status).toBe(400);
  const body = (await response.json()) as ErrorResponse;
  expect(body.error.message).toBe("Workspace must be running");
  expect(body.error.data.code).toBe("BAD_REQUEST");
  expect(body.error.data.workspaceLifecycleCode).toBe("WORKSPACE_NOT_RUNNING");
});

test("ordinary BAD_REQUEST errors do not acquire a lifecycle code from their message", async () => {
  const router = t.router({
    fail: t.procedure.query(() => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Mentioning WORKSPACE_NOT_RUNNING is not a typed error",
      });
    }),
  });
  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    req: new Request("http://localhost/trpc/fail"),
    router,
    createContext: async () => ({}) as Context,
  });
  const body = (await response.json()) as ErrorResponse;
  expect(body.error.data.workspaceLifecycleCode).toBeNull();
});
