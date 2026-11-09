import { and, db, eq } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";

/** Without renewal a hold lapses this fast, so a process that died gives up its workspace. */
const OPERATION_LEASE_MS = 2 * 60_000;

export const operationLease = () => new Date(Date.now() + OPERATION_LEASE_MS);

/**
 * Runs a create or restart while it holds the workspace's operation lease: reconciling with the
 * provider leaves a `pending` workspace to its operation while the lease is current. Renewed
 * until `run` settles, then released. A claim that set the lease with its update passes it in.
 */
export async function holdWorkspaceOperation<T>(
  workspaceId: string,
  run: () => Promise<T>,
  claimed?: Date,
): Promise<T> {
  let lease = claimed ?? operationLease();
  if (!claimed)
    await db
      .update(workspace)
      .set({ operationLeaseUntil: lease })
      .where(eq(workspace.id, workspaceId));
  // Only our own lease: one renewed or released after we lost it belongs to someone else.
  const ours = () => and(eq(workspace.id, workspaceId), eq(workspace.operationLeaseUntil, lease));
  let renewal = Promise.resolve();
  const heartbeat = setInterval(() => {
    const next = operationLease();
    renewal = renewal
      .then(async () => {
        const renewed = await db
          .update(workspace)
          .set({ operationLeaseUntil: next })
          .where(ours())
          .returning({ id: workspace.id });
        if (renewed.length) lease = next;
      })
      .catch((error) => console.error(`Could not renew the lease on ${workspaceId}:`, error));
  }, OPERATION_LEASE_MS / 3);
  try {
    return await run();
  } finally {
    clearInterval(heartbeat);
    await renewal;
    await db
      .update(workspace)
      .set({ operationLeaseUntil: null })
      .where(ours())
      .catch((error) => console.error(`Could not release the lease on ${workspaceId}:`, error));
  }
}
