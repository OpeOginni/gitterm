import { createHash, randomUUID } from "node:crypto";
import { and, db, desc, eq, inArray, sql } from "@gitterm/db";
import { agentRun, type AgentRun } from "@gitterm/db/schema/agent-run";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { model, userModelCredential } from "@gitterm/db/schema/model-credentials";
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
  startTimeoutMs?: number;
  context?: { type: "isolated" } | { type: "continue"; runId: string };
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
        context:
          input.context?.type === "continue"
            ? { type: "continue", runId: input.context.runId }
            : { type: "isolated" },
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
    context: run.parentRunId
      ? { type: "continued" as const, runId: run.parentRunId }
      : { type: "isolated" as const },
    createdAt: run.createdAt.toISOString(),
    submittedAt: run.submittedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
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

function notRunningError(status: string): TRPCError {
  if (status === "terminated") {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "WORKSPACE_TERMINATED: workspace has been terminated",
    });
  }
  return new TRPCError({
    code: "BAD_REQUEST",
    message: `WORKSPACE_NOT_RUNNING: workspace is ${status}${status === "paused" ? "; call workspaces.ensureRunning() to resume it" : ""}`,
  });
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

async function getRuntimeTarget(workspaceId: string, userId: string) {
  const record = await getRunWorkspace(workspaceId, userId);
  if (record.status !== "running" || !record.subdomain) {
    throw notRunningError(record.status);
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

async function validateModelCredential(
  workspaceRecord: Awaited<ReturnType<typeof getRunWorkspace>>,
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
  const native = await getOpencodeRun({
    ...target,
    workspaceId: run.workspaceId,
    runId: run.nativeSessionId,
    messageId: run.nativeMessageId,
    missingAssistantIsFailure,
  });
  const terminal =
    native.status === "completed" || native.status === "failed" || native.status === "cancelled";
  const [updated] = await db
    .update(agentRun)
    .set({
      status: native.status,
      errorMessage: native.error,
      finalText: native.finalText,
      messages: native.messages,
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

  await waitForWorkspaceRunning(input.workspaceId, userId, input.startTimeoutMs ?? 120_000);
  const target = await getRuntimeTarget(input.workspaceId, userId);
  await validateModelCredential(target.workspace, userId, input.model);
  if (input.waitForSetup) {
    await waitForSetup(input.workspaceId, userId, input.setupTimeoutMs ?? 10 * 60_000);
  }
  await waitForRuntimeReady(target.url);

  const id = randomUUID();
  const nativeMessageId = `msg_${id.replaceAll("-", "")}`;
  let parentRun: AgentRun | undefined;
  if (input.context?.type === "continue") {
    parentRun = await getOwnedRun(input.workspaceId, input.context.runId, userId);
    if (ACTIVE_RUN_STATUSES.includes(parentRun.status as (typeof ACTIVE_RUN_STATUSES)[number])) {
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
      const native = await createOpencodeSession({ ...target, title: input.title });
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
        await cancelNativeRun(target, nativeSessionId).catch(() => undefined);
        await deleteNativeSession(target, nativeSessionId).catch(() => undefined);
      }
      return publicRun(await getOwnedRun(input.workspaceId, inserted.id, userId));
    }
    await submitOpencodePrompt({
      ...target,
      sessionId: nativeSessionId,
      messageId: nativeMessageId,
      prompt: input.prompt,
      agent: input.agent,
      model: input.model,
    });
    const current = await getOwnedRun(input.workspaceId, inserted.id, userId);
    if (!ACTIVE_RUN_STATUSES.includes(current.status as (typeof ACTIVE_RUN_STATUSES)[number])) {
      await cancelNativeRun(target, nativeSessionId).catch(() => undefined);
      if (ownsNativeSession) {
        await deleteNativeSession(target, nativeSessionId).catch(() => undefined);
      }
    }
    return publicRun(current);
  } catch (error) {
    if (nativeSessionId) {
      await cancelNativeRun(target, nativeSessionId).catch(() => undefined);
      if (ownsNativeSession) {
        await deleteNativeSession(target, nativeSessionId).catch(() => undefined);
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
    conditions.push(inArray(agentRun.status, ["completed", "failed", "cancelled"]));
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

  // Active runs are reconciled against the workspace so callers recovering
  // after a restart see current statuses; terminal rows are already final.
  const runs = await Promise.all(
    rows.map((row) =>
      ACTIVE_RUN_STATUSES.includes(row.status as (typeof ACTIVE_RUN_STATUSES)[number])
        ? reconcileRun(row, userId)
        : Promise.resolve(row),
    ),
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

export async function cancelAgentRun(workspaceId: string, runId: string, userId: string) {
  const run = await getOwnedRun(workspaceId, runId, userId);
  if (!ACTIVE_RUN_STATUSES.includes(run.status as (typeof ACTIVE_RUN_STATUSES)[number])) {
    return { cancelled: run.status === "cancelled" };
  }

  let contextReusable = false;
  if (run.nativeSessionId) {
    const workspaceRecord = await getRunWorkspace(workspaceId, userId);
    if (workspaceRecord.status === "running") {
      const target = await getRuntimeTarget(workspaceId, userId);
      contextReusable = await cancelNativeRun(target, run.nativeSessionId)
        .then(() => true)
        .catch(() => false);
    }
  }

  const [updated] = await db
    .update(agentRun)
    .set({
      status: "cancelled",
      completedAt: new Date(),
      updatedAt: new Date(),
      nativeSessionId: contextReusable ? run.nativeSessionId : null,
    })
    .where(and(eq(agentRun.id, run.id), inArray(agentRun.status, [...ACTIVE_RUN_STATUSES])))
    .returning();
  if (updated) return { cancelled: true };

  const current = await getOwnedRun(workspaceId, runId, userId);
  return { cancelled: current.status === "cancelled" };
}

export async function finalizeWorkspaceAgentRuns(workspaceId: string, userId: string) {
  const runs = await db
    .select({ id: agentRun.id })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.workspaceId, workspaceId),
        inArray(agentRun.status, [...ACTIVE_RUN_STATUSES]),
      ),
    );
  await Promise.all(runs.map((run) => cancelAgentRun(workspaceId, run.id, userId)));
}
