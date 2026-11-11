import { TRPCError } from "@trpc/server";
import { SandboxProviderError } from "@gitterm/agent-runtime/sandbox/types";
import { SANDBOX_PROVIDER_PROFILES } from "@gitterm/agent-runtime/sandbox/types";
import { and, db, desc, eq, gt, isNotNull, ne, or, sql } from "@gitterm/db";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { sandboxSnapshot, workspace } from "@gitterm/db/schema/workspace";
import { PROJECT_SNAPSHOT_PROVIDERS, type ProjectSnapshotProvider } from "../providers/compute";
import { getProviderByCloudProviderId } from "../providers";
import { PREPARE_PROJECT_SNAPSHOT_COMMAND } from "../providers/project-snapshot";
import { managedSandboxTransport, parseSandboxHandle } from "./sandbox-transport";

/** A save that never finished stops counting against the plan limit after this long. */
const SNAPSHOT_SAVE_WINDOW_MS = 60 * 60_000;

type WorkspaceRow = typeof workspace.$inferSelect;
type SnapshotRow = typeof sandboxSnapshot.$inferSelect;

/** The provider as one whose workspaces can be kept as project snapshots, or null. */
export function projectSnapshotProvider(providerKey: string): ProjectSnapshotProvider | null {
  return (
    PROJECT_SNAPSHOT_PROVIDERS.find(
      (key) =>
        key === providerKey && SANDBOX_PROVIDER_PROFILES[key].capabilities.snapshots !== "none",
    ) ?? null
  );
}

/**
 * The provider's own id of the machine behind a workspace's stored handle. Most providers
 * store it bare; Boat stores a JSON handle and Gitterm a `sandbox:` one.
 */
export function workspaceMachineId(externalInstanceId: string): string {
  const handle = parseSandboxHandle(externalInstanceId);
  if (handle) return handle.id;
  try {
    const parsed = JSON.parse(externalInstanceId) as { boxId?: unknown };
    if (typeof parsed.boxId === "string") return parsed.boxId;
  } catch {
    /* A bare id. */
  }
  return externalInstanceId;
}

const sameProject = (userId: string, repositoryUrl: string, cloudProviderId: string) =>
  and(
    eq(sandboxSnapshot.userId, userId),
    eq(sandboxSnapshot.repositoryUrl, repositoryUrl),
    eq(sandboxSnapshot.cloudProviderId, cloudProviderId),
  );

/**
 * The user's saved snapshot for a repository on a provider. With `imageId`, only one saved
 * from a workspace on that image: a snapshot holds the agent the image installed.
 */
export async function findProjectSnapshot(input: {
  userId: string;
  repositoryUrl: string;
  cloudProviderId: string;
  imageId?: string;
}): Promise<SnapshotRow | undefined> {
  const [row] = await db
    .select()
    .from(sandboxSnapshot)
    .where(
      and(
        sameProject(input.userId, input.repositoryUrl, input.cloudProviderId),
        isNotNull(sandboxSnapshot.externalSnapshotId),
        input.imageId ? eq(sandboxSnapshot.imageId, input.imageId) : undefined,
      ),
    )
    .orderBy(desc(sandboxSnapshot.createdAt))
    .limit(1);
  return row;
}

export type ProjectSnapshotStatus = {
  /** Whether this workspace can be kept as its repository's snapshot right now. */
  available: boolean;
  /** Why not, when it cannot. */
  reason?: "provider" | "plan" | "repository" | "not_running";
  /** The snapshot already saved for this repository on this provider. */
  existing: { id: string; createdAt: string } | null;
};

/** Whether a workspace can be kept as its repository's snapshot, and what it would replace. */
export async function projectSnapshotStatus(
  row: WorkspaceRow,
  providerKey: string,
  maxSnapshots: number | null,
): Promise<ProjectSnapshotStatus> {
  const existing =
    row.userId && row.repositoryUrl && row.cloudProviderId
      ? await findProjectSnapshot({
          userId: row.userId,
          repositoryUrl: row.repositoryUrl,
          cloudProviderId: row.cloudProviderId,
        })
      : undefined;
  const reason = !projectSnapshotProvider(providerKey)
    ? "provider"
    : !row.repositoryUrl
      ? "repository"
      : maxSnapshots === 0
        ? "plan"
        : row.status !== "running" || !row.externalInstanceId
          ? "not_running"
          : undefined;
  return {
    available: !reason,
    ...(reason ? { reason } : {}),
    existing: existing ? { id: existing.id, createdAt: existing.createdAt.toISOString() } : null,
  };
}

/**
 * Keeps a running workspace's disk as the snapshot for its repository, replacing the one
 * saved before. The workspace is prepared first: its agent is stopped and its credentials
 * and conversations are removed, so the caller must delete the workspace afterwards.
 */
export async function saveProjectSnapshot(
  row: WorkspaceRow,
  providerKey: string,
  maxSnapshots: number | null,
): Promise<SnapshotRow> {
  const provider = projectSnapshotProvider(providerKey);
  const refuse = (message: string) => new TRPCError({ code: "PRECONDITION_FAILED", message });
  if (!provider) throw refuse(`${providerKey} workspaces can't be saved as a snapshot.`);
  if (!row.userId || !row.repositoryUrl || !row.cloudProviderId)
    throw refuse("Only a workspace with a repository can be saved as a project snapshot.");
  if (row.status !== "running" || !row.externalInstanceId)
    throw refuse("Only a running workspace can be saved as a snapshot.");
  if (maxSnapshots === 0)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your plan doesn't include snapshots. Upgrade to save them.",
    });
  const { userId, repositoryUrl, cloudProviderId } = row;
  const project = sameProject(userId, repositoryUrl, cloudProviderId);

  const pending = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`snapshot-quota:${userId}`}))`);
    if (maxSnapshots !== null) {
      // The one this save replaces does not take a second slot.
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sandboxSnapshot)
        .where(
          and(
            eq(sandboxSnapshot.userId, userId),
            or(
              isNotNull(sandboxSnapshot.externalSnapshotId),
              gt(sandboxSnapshot.createdAt, new Date(Date.now() - SNAPSHOT_SAVE_WINDOW_MS)),
            ),
            sql`not (${sandboxSnapshot.repositoryUrl} is not distinct from ${repositoryUrl} and ${sandboxSnapshot.cloudProviderId} = ${cloudProviderId})`,
          ),
        )) as [{ count: number }];
      if (count >= maxSnapshots)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `You've reached your plan limit of ${maxSnapshots} snapshots. Delete one first.`,
        });
    }
    const [created] = await tx
      .insert(sandboxSnapshot)
      .values({
        userId,
        cloudProviderId,
        machineProfileId: row.machineProfileId,
        label: repositoryUrl.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, ""),
        repositoryUrl,
        imageId: row.imageId,
      })
      .returning();
    return created!;
  });

  let external: string;
  try {
    // Credentials and conversations must not be kept in a snapshot, so a workspace that
    // cannot be prepared is not saved.
    const compute = await getProviderByCloudProviderId(providerKey, cloudProviderId);
    if (!compute.execCommand) throw refuse(`${providerKey} workspaces can't be prepared.`);
    await compute.execCommand(row.externalInstanceId, PREPARE_PROJECT_SNAPSHOT_COMMAND);
    const transport = await managedSandboxTransport(provider, cloudProviderId);
    if (!transport.snapshots) throw refuse(`${providerKey} workspaces can't be saved.`);
    external = await transport.snapshots.create(
      workspaceMachineId(row.externalInstanceId),
      `gitterm-${pending.id}`,
    );
  } catch (error) {
    await db.delete(sandboxSnapshot).where(eq(sandboxSnapshot.id, pending.id));
    if (error instanceof SandboxProviderError)
      throw new TRPCError({ code: "BAD_GATEWAY", message: error.message });
    throw error;
  }
  const [saved] = await db
    .update(sandboxSnapshot)
    .set({ externalSnapshotId: external })
    .where(eq(sandboxSnapshot.id, pending.id))
    .returning();

  // One per repository and provider: the older ones go. A provider that refuses keeps its
  // row, so the snapshot stays listed and can be deleted by hand.
  const older = await db
    .select()
    .from(sandboxSnapshot)
    .where(and(project, ne(sandboxSnapshot.id, pending.id)));
  for (const stale of older) {
    try {
      if (stale.externalSnapshotId) {
        const transport = await managedSandboxTransport(provider, cloudProviderId);
        await transport.snapshots?.delete(stale.externalSnapshotId);
      }
      await db.delete(sandboxSnapshot).where(eq(sandboxSnapshot.id, stale.id));
    } catch (error) {
      console.error("Could not delete a replaced project snapshot", stale.id, error);
    }
  }
  return saved!;
}

/** The provider key of a workspace's cloud provider. */
export async function workspaceProviderKey(row: WorkspaceRow): Promise<string | undefined> {
  if (!row.cloudProviderId) return undefined;
  const [provider] = await db
    .select({ providerKey: cloudProvider.providerKey })
    .from(cloudProvider)
    .where(eq(cloudProvider.id, row.cloudProviderId));
  return provider?.providerKey;
}
