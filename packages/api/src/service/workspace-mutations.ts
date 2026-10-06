import type { SQL } from "drizzle-orm";
import { db, eq } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import { invalidateProxyCacheForWorkspace } from "./proxy-cache";
import { closeOpenUsageSessions } from "../utils/metering";

type WorkspaceUpdate = Partial<typeof workspace.$inferInsert>;

export type WorkspaceStatusUpdateResult = {
  id: string;
  status: "pending" | "running" | "paused" | "terminated";
  updatedAt: Date;
  userId: string;
  workspaceDomain: string;
  subdomain: string | null;
};

/**
 * A workspace that stops running must stop metering. Paths that close the
 * session themselves (with a specific stop source) do so first; this catches
 * every other way a workspace becomes paused or terminated.
 */
async function closeUsageIfStopped(workspaceIds: string[], set: WorkspaceUpdate) {
  if (set.status === "paused" || set.status === "terminated") {
    await closeOpenUsageSessions(workspaceIds, "provider_auto");
  }
}

async function invalidateUpdatedWorkspaces(
  workspaces: Array<{ id: string; subdomain?: string | null }>,
) {
  await Promise.all(
    workspaces.map((updatedWorkspace) =>
      invalidateProxyCacheForWorkspace({
        workspaceId: updatedWorkspace.id,
        subdomain: updatedWorkspace.subdomain,
      }),
    ),
  );
}

export async function updateWorkspaceByIdAndInvalidate(
  workspaceId: string,
  set: WorkspaceUpdate,
  subdomain?: string | null,
) {
  await db.update(workspace).set(set).where(eq(workspace.id, workspaceId));
  await closeUsageIfStopped([workspaceId], set);
  await invalidateProxyCacheForWorkspace({ workspaceId, subdomain });
}

export async function updateWorkspaceByIdReturningAndInvalidate(
  workspaceId: string,
  set: WorkspaceUpdate,
) {
  const updatedWorkspaces = await db
    .update(workspace)
    .set(set)
    .where(eq(workspace.id, workspaceId))
    .returning();

  await closeUsageIfStopped(
    updatedWorkspaces.map((row) => row.id),
    set,
  );
  await invalidateUpdatedWorkspaces(updatedWorkspaces);
  return updatedWorkspaces;
}

export async function updateWorkspaceStatusAndInvalidate(
  where: SQL | undefined,
  set: WorkspaceUpdate,
) {
  const updatedWorkspaces = await db.update(workspace).set(set).where(where).returning({
    id: workspace.id,
    status: workspace.status,
    updatedAt: workspace.updatedAt,
    userId: workspace.userId,
    workspaceDomain: workspace.domain,
    subdomain: workspace.subdomain,
  });

  await closeUsageIfStopped(
    updatedWorkspaces.map((row) => row.id),
    set,
  );
  await invalidateUpdatedWorkspaces(updatedWorkspaces);
  return updatedWorkspaces satisfies WorkspaceStatusUpdateResult[];
}

export async function updateWorkspaceRoutingAndInvalidate(
  workspaceId: string,
  set: WorkspaceUpdate,
  subdomain?: string | null,
) {
  await updateWorkspaceByIdAndInvalidate(workspaceId, set, subdomain);
}

export async function invalidateWorkspaceCacheAfterMutation(
  workspaceId: string,
  subdomain?: string | null,
) {
  await invalidateProxyCacheForWorkspace({ workspaceId, subdomain });
}
