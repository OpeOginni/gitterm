import { and, db, eq } from "@gitterm/db";
import { agentRun } from "@gitterm/db/schema/agent-run";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { workspace } from "@gitterm/db/schema/workspace";
import { TRPCError } from "@trpc/server";
import { getWorkspaceUrl } from "../../utils/routing";
import { decryptWorkspacePassword } from "../../utils/workspace-password";
import { resolveProjectDirectory } from "../workspace-runtime";
import type { RuntimeTarget } from "./runtime";

export async function getOwnedRun(workspaceId: string, runId: string, userId: string) {
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

async function findWorkspace(workspaceId: string, userId?: string) {
  return db.query.workspace.findFirst({
    where: userId
      ? and(eq(workspace.id, workspaceId), eq(workspace.userId, userId))
      : eq(workspace.id, workspaceId),
    with: { image: { with: { agentType: true } } },
  });
}

export type RunWorkspace = NonNullable<Awaited<ReturnType<typeof findWorkspace>>>;

export async function getRunWorkspace(workspaceId: string, userId: string): Promise<RunWorkspace> {
  const record = await findWorkspace(workspaceId, userId);
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  return record;
}

export function notRunningError(status: string): TRPCError {
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

function isOpencodeServerWorkspace(record: RunWorkspace): boolean {
  return record.image.agentType.provisionerKey === "opencode" && record.serverOnly;
}

async function buildTarget(record: RunWorkspace & { subdomain: string }): Promise<RuntimeTarget> {
  const [provider] = await db
    .select({ providerKey: cloudProvider.providerKey })
    .from(cloudProvider)
    .where(eq(cloudProvider.id, record.cloudProviderId));
  return {
    url: getWorkspaceUrl(record.subdomain),
    directory: resolveProjectDirectory(record.repositoryUrl, provider?.providerKey),
    password: record.serverPassword ? decryptWorkspacePassword(record.serverPassword) : null,
    api: record.opencodeApi,
  };
}

export async function getRuntimeTarget(workspaceId: string, userId: string) {
  const record = await getRunWorkspace(workspaceId, userId);
  if (record.status !== "running" || !record.subdomain) {
    throw notRunningError(record.status);
  }
  if (!isOpencodeServerWorkspace(record)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Runs require an OpenCode server workspace",
    });
  }
  return { workspace: record, ...(await buildTarget({ ...record, subdomain: record.subdomain })) };
}

export type WorkspaceRuntimeLookup =
  | { kind: "ok"; target: RuntimeTarget }
  | { kind: "unavailable"; status: string };

/** Resolve a workspace's agent server without a user context (for the run watcher). */
export async function getRuntimeTargetForWorkspace(
  workspaceId: string,
): Promise<WorkspaceRuntimeLookup> {
  const record = await findWorkspace(workspaceId);
  if (!record) return { kind: "unavailable", status: "missing" };
  if (record.status !== "running" || !record.subdomain || !isOpencodeServerWorkspace(record)) {
    return { kind: "unavailable", status: record.status };
  }
  return { kind: "ok", target: await buildTarget({ ...record, subdomain: record.subdomain }) };
}
