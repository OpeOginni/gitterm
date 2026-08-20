import { createHash, randomUUID } from "node:crypto";
import { and, db, eq, inArray } from "@gitterm/db";
import { agentRun, type AgentRun } from "@gitterm/db/schema/agent-run";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { workspace } from "@gitterm/db/schema/workspace";
import { TRPCError } from "@trpc/server";
import { getWorkspaceSetupStatus } from "../workspace-setup";
import { resolveProjectDirectory } from "../workspace-runtime";
import { getWorkspaceUrl } from "../../utils/routing";
import { decryptWorkspacePassword } from "../../utils/workspace-password";
import {
  cancelOpencodeRun,
  createOpencodeSession,
  deleteOpencodeSession,
  getOpencodeRun,
  getOpencodeRunMessages,
  submitOpencodePrompt,
} from "./opencode";

const ACTIVE_RUN_STATUSES = ["pending", "running", "retrying"] as const;
const MISSING_ASSISTANT_GRACE_MS = 10_000;
const ABANDONED_PENDING_MS = 30_000;
const NATIVE_CANCEL_TIMEOUT_MS = 2_000;

type RunCreateInput = {
  workspaceId: string;
  idempotencyKey: string;
  prompt: string;
  title?: string;
  agent?: string;
  model?: string;
  waitForSetup?: boolean;
  setupTimeoutMs?: number;
};

function requestHash(input: RunCreateInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        workspaceId: input.workspaceId,
        prompt: input.prompt,
        title: input.title ?? null,
        agent: input.agent ?? null,
        model: input.model ?? null,
      }),
    )
    .digest("hex");
}

function publicRun(run: AgentRun) {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    title: run.title,
    status: run.status,
    error: run.errorMessage,
    finalText: run.finalText,
  };
}

async function getOwnedRun(workspaceId: string, runId: string, userId: string) {
  const [result] = await db
    .select({ run: agentRun })
    .from(agentRun)
    .innerJoin(workspace, eq(workspace.id, agentRun.workspaceId))
    .where(
      and(
        eq(agentRun.id, runId),
        eq(agentRun.workspaceId, workspaceId),
        eq(workspace.userId, userId),
      ),
    )
    .limit(1);
  if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
  return result.run;
}

async function getRunWorkspace(workspaceId: string, userId: string) {
  const record = await db.query.workspace.findFirst({
    where: and(eq(workspace.id, workspaceId), eq(workspace.userId, userId)),
    with: { image: { with: { agentType: true } } },
  });
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  return record;
}

async function getRuntimeTarget(workspaceId: string, userId: string) {
  const record = await getRunWorkspace(workspaceId, userId);
  if (record.status !== "running" || !record.subdomain) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace must be running" });
  }
  if (record.image.agentType.provisionerKey !== "opencode" || !record.serverOnly) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Runs require an OpenCode server workspace",
    });
  }
  const [provider] = await db
    .select({ providerKey: cloudProvider.providerKey })
    .from(cloudProvider)
    .where(eq(cloudProvider.id, record.cloudProviderId));
  return {
    workspace: record,
    url: getWorkspaceUrl(record.subdomain),
    directory: resolveProjectDirectory(record.repositoryUrl, provider?.providerKey),
    password: record.serverPassword ? decryptWorkspacePassword(record.serverPassword) : null,
  };
}

async function withNativeTimeout(operation: Promise<unknown>, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), NATIVE_CANCEL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function cancelNativeRun(
  target: Awaited<ReturnType<typeof getRuntimeTarget>>,
  nativeSessionId: string,
) {
  await withNativeTimeout(
    cancelOpencodeRun({ ...target, runId: nativeSessionId }),
    "Timed out cancelling native agent run",
  );
}

async function deleteNativeSession(
  target: Awaited<ReturnType<typeof getRuntimeTarget>>,
  nativeSessionId: string,
) {
  await withNativeTimeout(
    deleteOpencodeSession({ ...target, sessionId: nativeSessionId }),
    "Timed out deleting native agent session",
  );
}

async function waitForSetup(workspaceId: string, userId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const record = await getRunWorkspace(workspaceId, userId);
    if (record.status !== "running") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace stopped during setup" });
    }
    const setup = await getWorkspaceSetupStatus(workspaceId, record.setupRequired);
    if (setup.status === "not_requested" || setup.status === "succeeded") return;
    if (setup.status === "failed") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Workspace setup failed${setup.exitCode === null ? "" : ` with exit code ${setup.exitCode}`}`,
      });
    }
    if (Date.now() >= deadline) {
      throw new TRPCError({ code: "TIMEOUT", message: "Timed out waiting for workspace setup" });
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function failRun(runId: string, message: string) {
  const [updated] = await db
    .update(agentRun)
    .set({
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(agentRun.id, runId), inArray(agentRun.status, [...ACTIVE_RUN_STATUSES])))
    .returning();
  return updated;
}

async function reconcileRun(run: AgentRun, userId: string): Promise<AgentRun> {
  if (!ACTIVE_RUN_STATUSES.includes(run.status as (typeof ACTIVE_RUN_STATUSES)[number])) return run;

  if (run.status === "pending") {
    if (Date.now() - run.updatedAt.getTime() < ABANDONED_PENDING_MS) return run;
    return (
      (await failRun(run.id, "Run submission did not complete")) ??
      (await getOwnedRun(run.workspaceId, run.id, userId))
    );
  }

  const workspaceRecord = await getRunWorkspace(run.workspaceId, userId);
  if (workspaceRecord.status !== "running" || !run.nativeSessionId) {
    const [updated] = await db
      .update(agentRun)
      .set({
        status: "cancelled",
        errorMessage: "Workspace stopped before the run completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(agentRun.id, run.id), inArray(agentRun.status, [...ACTIVE_RUN_STATUSES])))
      .returning();
    return updated ?? (await getOwnedRun(run.workspaceId, run.id, userId));
  }

  const target = await getRuntimeTarget(run.workspaceId, userId);
  const missingAssistantIsFailure =
    Boolean(run.submittedAt) &&
    Date.now() - (run.submittedAt?.getTime() ?? Date.now()) >= MISSING_ASSISTANT_GRACE_MS;
  const [native, messages] = await Promise.all([
    getOpencodeRun({
      ...target,
      workspaceId: run.workspaceId,
      runId: run.nativeSessionId,
      missingAssistantIsFailure,
    }),
    getOpencodeRunMessages({ ...target, runId: run.nativeSessionId }),
  ]);
  const terminal =
    native.status === "completed" || native.status === "failed" || native.status === "cancelled";
  const [updated] = await db
    .update(agentRun)
    .set({
      title: native.title,
      status: native.status,
      errorMessage: native.error,
      finalText: native.finalText,
      messages,
      completedAt: terminal ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(agentRun.id, run.id), inArray(agentRun.status, [...ACTIVE_RUN_STATUSES])))
    .returning();
  return updated ?? (await getOwnedRun(run.workspaceId, run.id, userId));
}

export async function createAgentRun(input: RunCreateInput, userId: string) {
  await getRunWorkspace(input.workspaceId, userId);
  const hash = requestHash(input);
  const existing = await db.query.agentRun.findFirst({
    where: and(
      eq(agentRun.workspaceId, input.workspaceId),
      eq(agentRun.idempotencyKey, input.idempotencyKey),
    ),
  });
  if (existing) {
    if (existing.requestHash !== hash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Idempotency key was already used with different run input",
      });
    }
    return publicRun(await reconcileRun(existing, userId));
  }

  const target = await getRuntimeTarget(input.workspaceId, userId);
  if (input.waitForSetup) {
    await waitForSetup(input.workspaceId, userId, input.setupTimeoutMs ?? 10 * 60_000);
  }

  const id = randomUUID();
  const [inserted] = await db
    .insert(agentRun)
    .values({
      id,
      workspaceId: input.workspaceId,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
      title: input.title ?? "Agent run",
    })
    .onConflictDoNothing({
      target: [agentRun.workspaceId, agentRun.idempotencyKey],
    })
    .returning();

  if (!inserted) {
    const racedExisting = await db.query.agentRun.findFirst({
      where: and(
        eq(agentRun.workspaceId, input.workspaceId),
        eq(agentRun.idempotencyKey, input.idempotencyKey),
      ),
    });
    if (!racedExisting) {
      throw new TRPCError({ code: "CONFLICT", message: "Run creation conflicted" });
    }
    if (racedExisting.requestHash !== hash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Idempotency key was already used with different run input",
      });
    }
    return publicRun(await reconcileRun(racedExisting, userId));
  }

  let nativeSessionId: string | undefined;
  try {
    const native = await createOpencodeSession({ ...target, title: input.title });
    nativeSessionId = native.id;
    const [submitting] = await db
      .update(agentRun)
      .set({
        nativeSessionId: native.id,
        title: native.title,
        status: "running",
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(agentRun.id, inserted.id), eq(agentRun.status, "pending")))
      .returning();
    if (!submitting) {
      await cancelNativeRun(target, native.id).catch(() => undefined);
      await deleteNativeSession(target, native.id).catch(() => undefined);
      return publicRun(await getOwnedRun(input.workspaceId, inserted.id, userId));
    }
    await submitOpencodePrompt({
      ...target,
      sessionId: native.id,
      messageId: `msg_${inserted.id.replaceAll("-", "")}`,
      prompt: input.prompt,
      agent: input.agent,
      model: input.model,
    });
    const current = await getOwnedRun(input.workspaceId, inserted.id, userId);
    if (!ACTIVE_RUN_STATUSES.includes(current.status as (typeof ACTIVE_RUN_STATUSES)[number])) {
      await cancelNativeRun(target, native.id).catch(() => undefined);
      await deleteNativeSession(target, native.id).catch(() => undefined);
    }
    return publicRun(current);
  } catch (error) {
    if (nativeSessionId) {
      await cancelNativeRun(target, nativeSessionId).catch(() => undefined);
      await deleteNativeSession(target, nativeSessionId).catch(() => undefined);
    }
    const failed = await failRun(
      inserted.id,
      error instanceof Error ? error.message : "Agent request failed",
    );
    return publicRun(failed ?? (await getOwnedRun(input.workspaceId, inserted.id, userId)));
  }
}

export async function getAgentRun(workspaceId: string, runId: string, userId: string) {
  const run = await getOwnedRun(workspaceId, runId, userId);
  return publicRun(await reconcileRun(run, userId));
}

export async function getAgentRunMessages(workspaceId: string, runId: string, userId: string) {
  const run = await getOwnedRun(workspaceId, runId, userId);
  return (await reconcileRun(run, userId)).messages;
}

export async function cancelAgentRun(workspaceId: string, runId: string, userId: string) {
  const run = await getOwnedRun(workspaceId, runId, userId);
  if (!ACTIVE_RUN_STATUSES.includes(run.status as (typeof ACTIVE_RUN_STATUSES)[number])) {
    return { cancelled: run.status === "cancelled" };
  }

  const [updated] = await db
    .update(agentRun)
    .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agentRun.id, run.id), inArray(agentRun.status, [...ACTIVE_RUN_STATUSES])))
    .returning();
  if (!updated) {
    const current = await getOwnedRun(workspaceId, runId, userId);
    return { cancelled: current.status === "cancelled" };
  }

  if (updated.nativeSessionId) {
    const workspaceRecord = await getRunWorkspace(workspaceId, userId);
    if (workspaceRecord.status === "running") {
      const target = await getRuntimeTarget(workspaceId, userId);
      await cancelNativeRun(target, updated.nativeSessionId).catch(() => undefined);
    }
  }
  return { cancelled: true };
}

export async function finalizeWorkspaceAgentRuns(workspaceId: string, userId: string) {
  await getRunWorkspace(workspaceId, userId);
  const now = new Date();
  const runs = await db
    .update(agentRun)
    .set({
      status: "cancelled",
      errorMessage: "Workspace stopped before the run completed",
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(agentRun.workspaceId, workspaceId),
        inArray(agentRun.status, [...ACTIVE_RUN_STATUSES]),
      ),
    )
    .returning();

  const nativeRuns = runs.filter((run) => run.nativeSessionId);
  if (nativeRuns.length === 0) return;

  const workspaceRecord = await getRunWorkspace(workspaceId, userId);
  if (workspaceRecord.status !== "running") return;
  const target = await getRuntimeTarget(workspaceId, userId);
  await Promise.allSettled(nativeRuns.map((run) => cancelNativeRun(target, run.nativeSessionId!)));
}
