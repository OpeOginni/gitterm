import type { SQL } from "drizzle-orm";
import { db, eq } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import { invalidateProxyCacheForWorkspace } from "./proxy-cache";

type WorkspaceUpdate = Partial<typeof workspace.$inferInsert>;

export type WorkspaceStatusUpdateResult = {
  id: string;
  status: "pending" | "running" | "stopped" | "terminated";
  updatedAt: Date;
  userId: string;
  workspaceDomain: string;
  subdomain: string | null;
};

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

  await invalidateUpdatedWorkspaces(updatedWorkspaces);
  return updatedWorkspaces;
}

export async function updateWorkspaceStatusAndInvalidate(where: SQL | undefined, set: WorkspaceUpdate) {
  const updatedWorkspaces = await db
    .update(workspace)
    .set(set)
    .where(where)
    .returning({
      id: workspace.id,
      status: workspace.status,
      updatedAt: workspace.updatedAt,
      userId: workspace.userId,
      workspaceDomain: workspace.domain,
      subdomain: workspace.subdomain,
    });

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
