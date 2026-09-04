import { createHash, randomUUID } from "node:crypto";
import { and, db, desc, eq, inArray, sql } from "@gitterm/db";
import { agentRun, type AgentRun, type AgentRunInputRequest } from "@gitterm/db/schema/agent-run";
import { model, userModelCredential } from "@gitterm/db/schema/model-credentials";
import { TRPCError } from "@trpc/server";
import { getWorkspaceSetupStatus } from "../workspace-setup";
import { publicRun } from "./public";
import {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  getRuntime,
  isActiveRunStatus,
  parseModelRef,
  type OpencodeRuntime,
  type PermissionReply,
} from "./runtime";
import { loadRun, settleRun, sleep } from "./store";
import {
  getOwnedRun,
  getRunWorkspace,
  getRuntimeTarget,
  notRunningError,
  runtimeTargetFor,
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

/** Webhook-settled providers (Railway) stay `pending` until the deployment reports success. */
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
    await sleep(2_000);
  }
}

async function validateModelCredential(
  workspaceRecord: RunWorkspace,
  userId: string,
  selectedModel: string | undefined,
) {
  if (!selectedModel) return;
  let provider: string;
  try {
    provider = parseModelRef(selectedModel)!.providerID;
  } catch {
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

  // OpenCode's own free catalog changes often; let it decide about auth.
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

/** The proxy answers 502/503/504 while the agent server is still booting. */
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
    await sleep(2_000);
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

/** Otherwise OpenCode keeps the prompt open after the abort. */
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
    await sleep(1_000);
  }
}

/** Repairs rows the watcher can't own: abandoned submissions and runs whose workspace stopped. */
async function reconcileRun(run: AgentRun, workspaceStatus: string): Promise<AgentRun> {
  if (!isActiveRunStatus(run.status)) return run;

  if (run.status === "pending") {
    if (Date.now() - run.updatedAt.getTime() < ABANDONED_PENDING_MS) return run;
    const settled = await settleRun(run.id, {
      status: "failed",
      errorMessage: "Run submission did not complete",
    });
    return settled ?? (await loadRun(run.id)) ?? run;
  }

  if (workspaceStatus !== "running" || !run.nativeSessionId) {
    untrackRun(run.workspaceId, run.id);
    const settled = await settleRun(run.id, {
      status: "cancelled",
      errorMessage: stoppedWorkspaceMessage(run.status),
    });
    return settled ?? (await loadRun(run.id)) ?? run;
  }

  (await ensureWorkspaceWatcher(run.workspaceId)).track(run);
  return run;
}

function findRunByIdempotencyKey(workspaceId: string, idempotencyKey: string) {
  return db.query.agentRun.findFirst({
    where: and(eq(agentRun.workspaceId, workspaceId), eq(agentRun.idempotencyKey, idempotencyKey)),
  });
}

async function reuseExistingRun(existing: AgentRun, hash: string, workspaceStatus: string) {
  if (existing.requestHash !== hash) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Idempotency key was already used with different run input",
    });
  }
  return publicRun(await reconcileRun(existing, workspaceStatus));
}

export async function createAgentRun(input: RunCreateInput, userId: string) {
  let workspaceRecord = await getRunWorkspace(input.workspaceId, userId);
  const hash = requestHash(input);
  const existing = await findRunByIdempotencyKey(input.workspaceId, input.idempotencyKey);
  if (existing) return reuseExistingRun(existing, hash, workspaceRecord.status);

  workspaceRecord = await waitForWorkspaceRunning(
    input.workspaceId,
    userId,
    input.startTimeoutMs ?? 120_000,
  );
  const target = await runtimeTargetFor(workspaceRecord);
  await validateModelCredential(workspaceRecord, userId, input.model);
  if (input.waitForSetup) {
    await waitForSetup(input.workspaceId, userId, input.setupTimeoutMs ?? 10 * 60_000);
  }
  await waitForRuntimeReady(target.url);
  const runtime = getRuntime(target);

  const id = randomUUID();
  const nativeMessageId = `msg_${id.replaceAll("-", "")}`;
  let parentRun: AgentRun | undefined;
  if (input.context?.type === "continue") {
    parentRun = (await getOwnedRun(input.workspaceId, input.context.runId, userId)).run;
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
    const raced = await findRunByIdempotencyKey(input.workspaceId, input.idempotencyKey);
    if (!raced) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "The selected run context has already been continued",
      });
    }
    return reuseExistingRun(raced, hash, workspaceRecord.status);
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
      return publicRun((await loadRun(inserted.id)) ?? inserted);
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
    const current = (await loadRun(inserted.id)) ?? submitting;
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
    const failed = await settleRun(inserted.id, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Agent request failed",
    });
    return publicRun(failed ?? (await loadRun(inserted.id)) ?? inserted);
  }
}

export async function getAgentRun(workspaceId: string, runId: string, userId: string) {
  const { run, workspaceStatus } = await getOwnedRun(workspaceId, runId, userId);
  return publicRun(await reconcileRun(run, workspaceStatus));
}

export async function listAgentRuns(
  workspaceId: string,
  userId: string,
  options: { status: "all" | "active" | "terminal"; limit: number; offset: number },
) {
  const workspaceRecord = await getRunWorkspace(workspaceId, userId);
  const conditions = [eq(agentRun.workspaceId, workspaceId)];
  if (options.status === "active") {
    conditions.push(inArray(agentRun.status, [...ACTIVE_RUN_STATUSES]));
  } else if (options.status === "terminal") {
    conditions.push(inArray(agentRun.status, [...TERMINAL_RUN_STATUSES]));
  }
  const where = and(...conditions);

  const [[countRow], rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(agentRun)
      .where(where),
    db
      .select()
      .from(agentRun)
      .where(where)
      .orderBy(desc(agentRun.createdAt))
      .limit(options.limit)
      .offset(options.offset),
  ]);

  const runs = await Promise.all(rows.map((row) => reconcileRun(row, workspaceRecord.status)));
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
  const { run, workspaceStatus } = await getOwnedRun(workspaceId, runId, userId);
  const current = await reconcileRun(run, workspaceStatus);
  // Rows only capture messages at lifecycle transitions; in-flight runs are read live.
  if (
    isActiveRunStatus(current.status) &&
    current.nativeSessionId &&
    workspaceStatus === "running"
  ) {
    const runtime = getRuntime(await getRuntimeTarget(workspaceId, userId));
    const live = await runtime
      .snapshot(current.nativeSessionId, current.nativeMessageId)
      .catch(() => null);
    if (live) return live.messages;
  }
  return current.messages;
}

export async function respondToAgentRun(
  input: { workspaceId: string; runId: string; requestId: string; reply: RunReply },
  userId: string,
) {
  const { run } = await getOwnedRun(input.workspaceId, input.runId, userId);
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
  return publicRun((await loadRun(run.id)) ?? run);
}

/** The session stays reusable for `context: continue` only when OpenCode confirmed the abort. */
async function cancelRun(run: AgentRun, runtime: OpencodeRuntime | null, reason: string | null) {
  if (!isActiveRunStatus(run.status)) return { cancelled: run.status === "cancelled" };

  let contextReusable = false;
  if (runtime && run.nativeSessionId) {
    await rejectPendingInputs(runtime, run.nativeSessionId, run.pendingInputs);
    contextReusable = await cancelNativeRun(runtime, run.nativeSessionId)
      .then(() => true)
      .catch(() => false);
  }

  untrackRun(run.workspaceId, run.id);
  const updated = await settleRun(run.id, {
    status: "cancelled",
    errorMessage: reason,
    nativeSessionId: contextReusable ? run.nativeSessionId : null,
  });
  if (updated) return { cancelled: true };
  const current = await loadRun(run.id);
  return { cancelled: current?.status === "cancelled" };
}

export async function cancelAgentRun(workspaceId: string, runId: string, userId: string) {
  const { run, workspaceStatus } = await getOwnedRun(workspaceId, runId, userId);
  if (!isActiveRunStatus(run.status)) return { cancelled: run.status === "cancelled" };
  const runtime =
    workspaceStatus === "running" && run.nativeSessionId
      ? getRuntime(await getRuntimeTarget(workspaceId, userId))
      : null;
  return cancelRun(run, runtime, null);
}

export async function finalizeWorkspaceAgentRuns(workspaceId: string, userId: string) {
  const runs = await db
    .select()
    .from(agentRun)
    .where(
      and(
        eq(agentRun.workspaceId, workspaceId),
        inArray(agentRun.status, [...ACTIVE_RUN_STATUSES]),
      ),
    );
  if (runs.length === 0) return;
  const workspaceRecord = await getRunWorkspace(workspaceId, userId);
  const runtime =
    workspaceRecord.status === "running"
      ? getRuntime(await runtimeTargetFor(workspaceRecord))
      : null;
  await Promise.all(
    runs.map((run) => cancelRun(run, runtime, stoppedWorkspaceMessage(run.status))),
  );
}
