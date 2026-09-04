import { createHash, randomUUID } from "node:crypto";
import { and, db, desc, eq, inArray, sql } from "@gitterm/db";
import { agentRun, type AgentRun, type AgentRunInputRequest } from "@gitterm/db/schema/agent-run";
import { model, userModelCredential } from "@gitterm/db/schema/model-credentials";
import { TRPCError } from "@trpc/server";
import { RUN_LIFECYCLE_EVENTS } from "../../events/run-lifecycle";
import { getWorkspaceSetupStatus } from "../workspace-setup";
import { publicRun } from "./public";
import {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  getRuntime,
  isActiveRunStatus,
  type OpencodeRuntime,
  type PermissionReply,
} from "./runtime";
import {
  getOwnedRun,
  getRunWorkspace,
  getRuntimeTarget,
  notRunningError,
  type RunWorkspace,
} from "./target";
import { ensureWorkspaceWatcher, stoppedWorkspaceMessage, untrackRun } from "./watcher";

export { publicRun, type PublicAgentRun } from "./public";
export { startRunWatcherSweep } from "./watcher";

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
  startTimeoutMs?: number;
  context?: { type: "isolated" } | { type: "continue"; runId: string };
};

export type RunReply =
  | { type: "permission"; response: PermissionReply }
  | { type: "question"; answers: string[][] }
  | { type: "question"; reject: true };

function requestHash(input: RunCreateInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        workspaceId: input.workspaceId,
        prompt: input.prompt,
        title: input.title ?? null,
        agent: input.agent ?? null,
        model: input.model ?? null,
        context:
          input.context?.type === "continue"
            ? { type: "continue", runId: input.context.runId }
            : { type: "isolated" },
      }),
    )
    .digest("hex");
}

/**
 * Providers with webhook settlement (e.g. Railway) return `pending` from
 * create until the deployment reports success. Wait for that transition so a
 * caller can go straight from create() to runs.create().
 */
async function waitForWorkspaceRunning(workspaceId: string, userId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const record = await getRunWorkspace(workspaceId, userId);
    if (record.status === "running") return record;
    if (record.status !== "pending") throw notRunningError(record.status);
    if (Date.now() >= deadline) {
      throw new TRPCError({
        code: "TIMEOUT",
        message: `WORKSPACE_START_TIMEOUT: workspace remained pending for ${Math.round(timeoutMs / 1000)}s`,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function validateModelCredential(
  workspaceRecord: RunWorkspace,
  userId: string,
  selectedModel: string | undefined,
) {
  if (!selectedModel) return;
  const separator = selectedModel.indexOf("/");
  if (separator <= 0 || separator === selectedModel.length - 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: 'MODEL_CREDENTIAL_REQUIRED: model must use the "provider/model" format',
    });
  }

  const [registeredModel] = await db
    .select({ isFree: model.isFree })
    .from(model)
    .where(eq(model.modelId, selectedModel))
    .limit(1);
  if (registeredModel?.isFree) return;

  const provider = selectedModel.slice(0, separator);
  // OpenCode periodically changes its free model catalog, so let OpenCode itself
  // decide whether a model from its own provider needs authentication.
  if (provider === "opencode") return;
  if (workspaceRecord.inlineModelProviders.includes(provider)) return;

  const credentialIds = workspaceRecord.modelCredentialIds;
  if (credentialIds.length > 0) {
    const credentials = await db
      .select({ logicalProviderKey: userModelCredential.logicalProviderKey })
      .from(userModelCredential)
      .where(
        and(
          eq(userModelCredential.userId, userId),
          eq(userModelCredential.isActive, true),
          inArray(userModelCredential.id, credentialIds),
        ),
      );
    if (credentials.some((credential) => credential.logicalProviderKey === provider)) return;
  }

  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `MODEL_CREDENTIAL_REQUIRED: Model "${selectedModel}" requires a credential for provider "${provider}". Recreate the workspace with a modelCredentials entry for that provider (a dashboard credential by label, or an inline apiKey).`,
  });
}

/**
 * A workspace reports "running" while its agent server may still be booting,
 * so wait until the proxy answers with anything but a gateway error.
 */
async function waitForRuntimeReady(url: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      await response.body?.cancel().catch(() => undefined);
      if (![502, 503, 504].includes(response.status)) return;
    } catch {}
    if (Date.now() >= deadline) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Workspace agent server did not become reachable within ${Math.round(timeoutMs / 1000)}s`,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
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

async function cancelNativeRun(runtime: OpencodeRuntime, nativeSessionId: string) {
  await withNativeTimeout(runtime.abort(nativeSessionId), "Timed out cancelling native agent run");
}

async function deleteNativeSession(runtime: OpencodeRuntime, nativeSessionId: string) {
  await withNativeTimeout(
    runtime.deleteSession(nativeSessionId),
    "Timed out deleting native agent session",
  );
}

/** Reject whatever the agent is blocked on so OpenCode doesn't keep the prompt open after we abort. */
async function rejectPendingInputs(
  runtime: OpencodeRuntime,
  nativeSessionId: string,
  pendingInputs: AgentRunInputRequest[],
) {
  for (const request of pendingInputs) {
    const rejection =
      request.kind === "permission"
        ? runtime.replyPermission(nativeSessionId, request.id, "reject")
        : runtime.rejectQuestion(nativeSessionId, request.id);
    await withNativeTimeout(rejection, "Timed out rejecting pending input").catch(() => undefined);
  }
}

async function waitForSetup(workspaceId: string, userId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const record = await getRunWorkspace(workspaceId, userId);
    if (record.status !== "running") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `WORKSPACE_NOT_RUNNING: workspace became ${record.status} during setup`,
      });
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

function publishRun(run: AgentRun) {
  RUN_LIFECYCLE_EVENTS.publish(run.id, { type: "run.updated", run: publicRun(run) });
}

async function failRun(runId: string, message: string) {
  const [updated] = await db
    .update(agentRun)
    .set({
      status: "failed",
      errorMessage: message,
      pendingInputs: [],
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(agentRun.id, runId), inArray(agentRun.status, [...ACTIVE_RUN_STATUSES])))
    .returning();
  if (updated) publishRun(updated);
  return updated;
}

async function cancelStoppedWorkspaceRun(run: AgentRun) {
  const [updated] = await db
    .update(agentRun)
    .set({
      status: "cancelled",
      errorMessage: stoppedWorkspaceMessage(run.status),
      pendingInputs: [],
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(agentRun.id, run.id), inArray(agentRun.status, [...ACTIVE_RUN_STATUSES])))
    .returning();
  if (updated) publishRun(updated);
  untrackRun(run.workspaceId, run.id);
  return updated;
}

/**
 * Active runs are kept current by the workspace watcher, so reads return the
 * stored row. This only repairs rows the watcher cannot own: abandoned
 * submissions and runs whose workspace has since stopped.
 */
async function reconcileRun(run: AgentRun, userId: string): Promise<AgentRun> {
  if (!isActiveRunStatus(run.status)) return run;

  if (run.status === "pending") {
    if (Date.now() - run.updatedAt.getTime() < ABANDONED_PENDING_MS) return run;
    return (
      (await failRun(run.id, "Run submission did not complete")) ??
      (await getOwnedRun(run.workspaceId, run.id, userId))
    );
  }

  const workspaceRecord = await getRunWorkspace(run.workspaceId, userId);
  if (workspaceRecord.status !== "running" || !run.nativeSessionId) {
    return (
      (await cancelStoppedWorkspaceRun(run)) ?? (await getOwnedRun(run.workspaceId, run.id, userId))
    );
  }

  (await ensureWorkspaceWatcher(run.workspaceId)).track(run);
  return run;
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

  await waitForWorkspaceRunning(input.workspaceId, userId, input.startTimeoutMs ?? 120_000);
  const target = await getRuntimeTarget(input.workspaceId, userId);
  await validateModelCredential(target.workspace, userId, input.model);
  if (input.waitForSetup) {
    await waitForSetup(input.workspaceId, userId, input.setupTimeoutMs ?? 10 * 60_000);
  }
  await waitForRuntimeReady(target.url);
  const runtime = getRuntime(target);

  const id = randomUUID();
  const nativeMessageId = `msg_${id.replaceAll("-", "")}`;
  let parentRun: AgentRun | undefined;
  if (input.context?.type === "continue") {
    parentRun = await getOwnedRun(input.workspaceId, input.context.runId, userId);
    if (isActiveRunStatus(parentRun.status)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "The previous run must finish before its context can be continued",
      });
    }
    if (!parentRun.nativeSessionId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The previous run does not have reusable context",
      });
    }
  }
  const [inserted] = await db
    .insert(agentRun)
    .values({
      id,
      workspaceId: input.workspaceId,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
      parentRunId: parentRun?.id,
      nativeSessionId: parentRun?.nativeSessionId,
      nativeMessageId,
      title: input.title ?? "Agent run",
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    const racedExisting = await db.query.agentRun.findFirst({
      where: and(
        eq(agentRun.workspaceId, input.workspaceId),
        eq(agentRun.idempotencyKey, input.idempotencyKey),
      ),
    });
    if (!racedExisting) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "The selected run context has already been continued",
      });
    }
    if (racedExisting.requestHash !== hash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Idempotency key was already used with different run input",
      });
    }
    return publicRun(await reconcileRun(racedExisting, userId));
  }

  let nativeSessionId = inserted.nativeSessionId ?? undefined;
  let ownsNativeSession = false;
  try {
    let nativeTitle = inserted.title;
    if (!nativeSessionId) {
      const native = await runtime.createSession({
        title: input.title,
        agent: input.agent,
        model: input.model,
      });
      nativeSessionId = native.id;
      nativeTitle = native.title;
      ownsNativeSession = true;
    }
    const [submitting] = await db
      .update(agentRun)
      .set({
        nativeSessionId,
        title: nativeTitle,
        status: "running",
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(agentRun.id, inserted.id), eq(agentRun.status, "pending")))
      .returning();
    if (!submitting) {
      if (ownsNativeSession) {
        await cancelNativeRun(runtime, nativeSessionId).catch(() => undefined);
        await deleteNativeSession(runtime, nativeSessionId).catch(() => undefined);
      }
      return publicRun(await getOwnedRun(input.workspaceId, inserted.id, userId));
    }
    // Attach before prompting so the first events land on a live watcher.
    (await ensureWorkspaceWatcher(input.workspaceId)).track(submitting);
    await runtime.prompt({
      sessionId: nativeSessionId,
      messageId: nativeMessageId,
      prompt: input.prompt,
      agent: input.agent,
      model: input.model,
    });
    const current = await getOwnedRun(input.workspaceId, inserted.id, userId);
    if (!isActiveRunStatus(current.status)) {
      await cancelNativeRun(runtime, nativeSessionId).catch(() => undefined);
      if (ownsNativeSession) {
        await deleteNativeSession(runtime, nativeSessionId).catch(() => undefined);
      }
    }
    return publicRun(current);
  } catch (error) {
    untrackRun(input.workspaceId, inserted.id);
    if (nativeSessionId) {
      await cancelNativeRun(runtime, nativeSessionId).catch(() => undefined);
      if (ownsNativeSession) {
        await deleteNativeSession(runtime, nativeSessionId).catch(() => undefined);
        await db
          .update(agentRun)
          .set({ nativeSessionId: null, updatedAt: new Date() })
          .where(eq(agentRun.id, inserted.id));
      }
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

export async function listAgentRuns(
  workspaceId: string,
  userId: string,
  options: { status: "all" | "active" | "terminal"; limit: number; offset: number },
) {
  await getRunWorkspace(workspaceId, userId);
  const conditions = [eq(agentRun.workspaceId, workspaceId)];
  if (options.status === "active") {
    conditions.push(inArray(agentRun.status, [...ACTIVE_RUN_STATUSES]));
  } else if (options.status === "terminal") {
    conditions.push(inArray(agentRun.status, [...TERMINAL_RUN_STATUSES]));
  }
  const where = and(...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(agentRun)
    .where(where);
  const rows = await db
    .select()
    .from(agentRun)
    .where(where)
    .orderBy(desc(agentRun.createdAt))
    .limit(options.limit)
    .offset(options.offset);

  const runs = await Promise.all(
    rows.map((row) => (isActiveRunStatus(row.status) ? reconcileRun(row, userId) : row)),
  );
  const total = Number(countRow?.count ?? 0);
  return {
    runs: runs.map(publicRun),
    pagination: {
      total,
      limit: options.limit,
      offset: options.offset,
      hasMore: options.offset + rows.length < total,
    },
  };
}

export async function getAgentRunMessages(workspaceId: string, runId: string, userId: string) {
  const run = await getOwnedRun(workspaceId, runId, userId);
  return (await reconcileRun(run, userId)).messages;
}

export async function respondToAgentRun(
  input: { workspaceId: string; runId: string; requestId: string; reply: RunReply },
  userId: string,
) {
  const run = await getOwnedRun(input.workspaceId, input.runId, userId);
  if (run.status !== "awaiting_input" || !run.nativeSessionId) {
    throw new TRPCError({ code: "CONFLICT", message: "Run is not waiting for input" });
  }
  const request = run.pendingInputs.find((candidate) => candidate.id === input.requestId);
  if (!request) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Input request not found or already answered",
    });
  }
  if (request.kind !== input.reply.type) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Request ${request.id} is a ${request.kind} request`,
    });
  }

  const runtime = getRuntime(await getRuntimeTarget(input.workspaceId, userId));
  if (request.kind === "permission" && input.reply.type === "permission") {
    await runtime.replyPermission(run.nativeSessionId, request.id, input.reply.response);
  } else if (request.kind === "question" && input.reply.type === "question") {
    if ("reject" in input.reply) await runtime.rejectQuestion(run.nativeSessionId, request.id);
    else await runtime.replyQuestion(run.nativeSessionId, request, input.reply.answers);
  }

  const watcher = await ensureWorkspaceWatcher(input.workspaceId);
  watcher.track(run);
  await watcher.resolveInput(run.id, request.id);
  return publicRun(await getOwnedRun(input.workspaceId, input.runId, userId));
}

export async function cancelAgentRun(
  workspaceId: string,
  runId: string,
  userId: string,
  options: { reason?: string } = {},
) {
  const run = await getOwnedRun(workspaceId, runId, userId);
  if (!isActiveRunStatus(run.status)) {
    return { cancelled: run.status === "cancelled" };
  }

  let contextReusable = false;
  if (run.nativeSessionId) {
    const workspaceRecord = await getRunWorkspace(workspaceId, userId);
    if (workspaceRecord.status === "running") {
      const runtime = getRuntime(await getRuntimeTarget(workspaceId, userId));
      await rejectPendingInputs(runtime, run.nativeSessionId, run.pendingInputs);
      contextReusable = await cancelNativeRun(runtime, run.nativeSessionId)
        .then(() => true)
        .catch(() => false);
    }
  }

  untrackRun(workspaceId, run.id);
  const [updated] = await db
    .update(agentRun)
    .set({
      status: "cancelled",
      errorMessage: options.reason ?? null,
      pendingInputs: [],
      completedAt: new Date(),
      updatedAt: new Date(),
      nativeSessionId: contextReusable ? run.nativeSessionId : null,
    })
    .where(and(eq(agentRun.id, run.id), inArray(agentRun.status, [...ACTIVE_RUN_STATUSES])))
    .returning();
  if (updated) {
    publishRun(updated);
    return { cancelled: true };
  }

  const current = await getOwnedRun(workspaceId, runId, userId);
  return { cancelled: current.status === "cancelled" };
}

/** The workspace is pausing or terminating: end every active run with a reason. */
export async function finalizeWorkspaceAgentRuns(workspaceId: string, userId: string) {
  const runs = await db
    .select({ id: agentRun.id, status: agentRun.status })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.workspaceId, workspaceId),
        inArray(agentRun.status, [...ACTIVE_RUN_STATUSES]),
      ),
    );
  await Promise.all(
    runs.map((run) =>
      cancelAgentRun(workspaceId, run.id, userId, { reason: stoppedWorkspaceMessage(run.status) }),
    ),
  );
}
