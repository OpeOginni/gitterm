import { and, db, eq, isNull, lte, or } from "@gitterm/db";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { workspaceRuntimeBundle } from "@gitterm/db/schema/credential-security";
import { volume, workspace, workspaceTermination } from "@gitterm/db/schema/workspace";
import { TRPCError } from "@trpc/server";
import { WORKSPACE_EVENTS } from "../events/workspace";
import { getProviderByCloudProviderId } from "../providers";
import { isProviderResourceNotFound } from "../providers/resource-not-found";
import { closeUsageSession } from "../utils/metering";
import { finalizeWorkspaceAgentRuns } from "./agent-run";
import {
  updateWorkspaceByIdReturningAndInvalidate,
  updateWorkspaceStatusAndInvalidate,
} from "./workspace-mutations";
import { deleteAllWorkspaceRouteAccess } from "./workspace-route-access";

/** Terminate a user's workspace. Queued teardown waits for remote cleanup, including AWS. */
export async function terminateWorkspace(userId: string, workspaceId: string, background = true) {
  const fetchedWorkspace = await db.query.workspace.findFirst({
    where: and(eq(workspace.id, workspaceId), eq(workspace.userId, userId)),
    with: { volume: true },
  });
  if (!fetchedWorkspace) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });

  await closeUsageSession(workspaceId, "manual");
  const [provider] = await db
    .select()
    .from(cloudProvider)
    .where(eq(cloudProvider.id, fetchedWorkspace.cloudProviderId));
  if (!provider)
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cloud provider not found" });

  const computeProvider = await getProviderByCloudProviderId(provider.providerKey, provider.id);
  await finalizeWorkspaceAgentRuns(workspaceId, userId);
  const terminatedAt = new Date();
  const [updatedWorkspace] = await updateWorkspaceByIdReturningAndInvalidate(workspaceId, {
    status: "terminated",
    authVersion: fetchedWorkspace.authVersion + 1,
    pausedAt: terminatedAt,
    terminatedAt,
    updatedAt: terminatedAt,
  });
  await deleteAllWorkspaceRouteAccess(workspaceId);
  await db
    .delete(workspaceRuntimeBundle)
    .where(eq(workspaceRuntimeBundle.workspaceId, workspaceId));
  WORKSPACE_EVENTS.emitStatus({
    workspaceId,
    status: "terminated",
    updatedAt: terminatedAt,
    userId,
    workspaceDomain: fetchedWorkspace.domain,
  });

  const runTerminationCleanup = async () => {
    if (fetchedWorkspace.externalInstanceId) {
      if (fetchedWorkspace.sshConnection) {
        await computeProvider
          .revokeWorkspaceSSHAccess({
            workspaceId,
            externalServiceId: fetchedWorkspace.externalInstanceId,
            connection: fetchedWorkspace.sshConnection,
          })
          .catch((error) => console.warn("Failed to revoke workspace editor access:", error));
      }
      for (const exposedPort of Object.values(fetchedWorkspace.exposedPorts ?? {})) {
        if (exposedPort?.externalPortDomainId)
          await computeProvider
            .removeExposedPortDomain(exposedPort.externalPortDomainId)
            .catch((error) => {
              if (!isProviderResourceNotFound(error)) throw error;
            });
      }
      await computeProvider
        .terminateWorkspace(
          fetchedWorkspace.externalInstanceId,
          fetchedWorkspace.persistent ? fetchedWorkspace.volume?.externalVolumeId : undefined,
        )
        .catch((error) => {
          if (!isProviderResourceNotFound(error)) throw error;
        });
    }

    // Late provisioning can publish a different handle while cleanup is running. Never erase it.
    await updateWorkspaceStatusAndInvalidate(
      and(
        eq(workspace.id, workspaceId),
        eq(workspace.externalInstanceId, fetchedWorkspace.externalInstanceId),
      ),
      {
        externalInstanceId: "",
        externalRunningDeploymentId: null,
        upstreamUrl: null,
        exposedPorts: null,
        sshConnection: null,
        updatedAt: new Date(),
      },
    );
    // Keep provider handles and volume records until remote deletion succeeds, for retries.
    if (fetchedWorkspace.volume)
      await db.delete(volume).where(eq(volume.id, fetchedWorkspace.volume.id));
  };

  const cleanupInBackground = background && provider.providerKey === "aws";
  if (cleanupInBackground) {
    void runTerminationCleanup().catch((error) =>
      console.error(`Failed to finish background termination for workspace ${workspaceId}:`, error),
    );
  } else {
    await runTerminationCleanup();
  }
  return { workspace: updatedWorkspace, success: true, cleanupInBackground };
}

// A dead process releases its claim automatically on a later worker pass.
const CLEANUP_LEASE_MS = 5 * 60_000;
export const WORKSPACE_TERMINATION_BATCH_SIZE = 5;
const available = () =>
  or(isNull(workspaceTermination.leaseUntil), lte(workspaceTermination.leaseUntil, new Date()));

export async function processWorkspaceTermination(userId: string, workspaceId: string) {
  let leaseUntil = new Date(Date.now() + CLEANUP_LEASE_MS);
  const [claimed] = await db
    .update(workspaceTermination)
    .set({ leaseUntil })
    .where(and(eq(workspaceTermination.workspaceId, workspaceId), available()))
    .returning();
  if (!claimed) return false;
  let renewing = false;
  let renewal = Promise.resolve();
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    const previousLease = leaseUntil;
    const nextLease = new Date(Date.now() + CLEANUP_LEASE_MS);
    renewal = db
      .update(workspaceTermination)
      .set({ leaseUntil: nextLease })
      .where(
        and(
          eq(workspaceTermination.workspaceId, workspaceId),
          eq(workspaceTermination.leaseUntil, previousLease),
        ),
      )
      .returning({ id: workspaceTermination.workspaceId })
      .then((rows) => {
        if (rows.length) leaseUntil = nextLease;
      })
      .catch((error) => console.error(`Could not renew cleanup claim for ${workspaceId}:`, error))
      .finally(() => {
        renewing = false;
      });
  }, CLEANUP_LEASE_MS / 3);
  const stopHeartbeat = async () => {
    clearInterval(heartbeat);
    await renewal;
  };
  try {
    await terminateWorkspace(userId, workspaceId, false);
    await stopHeartbeat();
    const completed = await db
      .delete(workspaceTermination)
      .where(
        and(
          eq(workspaceTermination.workspaceId, workspaceId),
          eq(workspaceTermination.generation, claimed.generation),
          eq(workspaceTermination.leaseUntil, leaseUntil),
        ),
      )
      .returning();
    return completed.length > 0;
  } finally {
    await stopHeartbeat();
    // Requeued late resources keep their new generation, but can be picked up immediately.
    await db
      .update(workspaceTermination)
      .set({ leaseUntil: null, createdAt: new Date() })
      .where(
        and(
          eq(workspaceTermination.workspaceId, workspaceId),
          eq(workspaceTermination.leaseUntil, leaseUntil),
        ),
      );
  }
}

/** Bound provider concurrency so deleting a large bot does not overwhelm the DB or provider. */
export async function processWorkspaceTerminations(rows: { id: string; userId: string }[]) {
  let terminated = 0;
  let failed = 0;
  for (let offset = 0; offset < rows.length; offset += WORKSPACE_TERMINATION_BATCH_SIZE) {
    const results = await Promise.allSettled(
      rows
        .slice(offset, offset + WORKSPACE_TERMINATION_BATCH_SIZE)
        .map(({ id, userId }) => processWorkspaceTermination(userId, id)),
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) terminated++;
      else {
        failed++;
        if (result.status === "rejected")
          console.error("Workspace cleanup will be retried:", result.reason);
      }
    }
  }
  return { terminated, failed };
}

export async function retryWorkspaceTerminations() {
  const rows = await db
    .select({ id: workspace.id, userId: workspace.userId })
    .from(workspaceTermination)
    .innerJoin(workspace, eq(workspace.id, workspaceTermination.workspaceId))
    .where(available())
    .orderBy(workspaceTermination.createdAt)
    .limit(WORKSPACE_TERMINATION_BATCH_SIZE);
  return processWorkspaceTerminations(rows);
}
