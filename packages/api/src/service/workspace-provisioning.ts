import { randomUUID } from "node:crypto";
import { and, db, eq, sql } from "@gitterm/db";
import { bot } from "@gitterm/db/schema/bot";
import { volume, workspace, workspaceTermination } from "@gitterm/db/schema/workspace";
import { TRPCError } from "@trpc/server";

type BotIdentity = Pick<typeof bot.$inferSelect, "id" | "apiTokenId"> | null;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockBot(tx: Transaction, userId: string, identity: NonNullable<BotIdentity>) {
  const [record] = await tx
    .select()
    .from(bot)
    .where(and(eq(bot.id, identity.id), eq(bot.userId, userId)))
    .for("update");
  return record;
}

/** Serialize reservation with deletion, without holding a DB lock during provider calls. */
export async function reserveWorkspace(
  values: typeof workspace.$inferInsert,
  identity: BotIdentity,
) {
  await db.transaction(async (tx) => {
    if (identity) {
      const record = await lockBot(tx, values.userId, identity);
      if (!record || record.apiTokenId !== identity.apiTokenId)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Bot identity has been revoked" });
    }
    await tx.insert(workspace).values({ ...values, botId: identity?.id ?? null });
  });
}

/** Publish provider handles and dependent records atomically, or queue late resources for teardown. */
export async function settleWorkspaceProvisioning(
  values: Partial<typeof workspace.$inferInsert> & {
    id: string;
    userId: string;
    externalInstanceId: string;
  },
  volumeValues: typeof volume.$inferInsert | null,
  identity: BotIdentity,
  onReady?: (tx: Transaction) => Promise<void>,
) {
  const result = await db.transaction(async (tx) => {
    const identityExists = !identity || !!(await lockBot(tx, values.userId, identity));
    const [reserved] = await tx
      .select()
      .from(workspace)
      .where(and(eq(workspace.id, values.id), eq(workspace.userId, values.userId)))
      .for("update");
    if (!reserved) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });

    let cancelled = !identityExists || reserved.status === "terminated";
    let [updated] = await tx
      .update(workspace)
      .set(
        cancelled
          ? {
              externalInstanceId: values.externalInstanceId,
              persistent: values.persistent ?? reserved.persistent,
              status: "terminated",
              updatedAt: new Date(),
            }
          : values,
      )
      .where(eq(workspace.id, values.id))
      .returning();
    const [persistedVolume] = volumeValues
      ? await tx.insert(volume).values(volumeValues).returning()
      : [];

    let publicationFailure: { error: unknown } | null = null;
    if (!cancelled) {
      try {
        // A savepoint rolls back partial setup/usage records without losing provider handles.
        await tx.transaction(async (publication) => {
          await onReady?.(publication);
        });
      } catch (error) {
        publicationFailure = { error };
        cancelled = true;
        [updated] = await tx
          .update(workspace)
          .set({
            status: "terminated",
            authVersion: sql`${workspace.authVersion} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(workspace.id, values.id))
          .returning();
      }
    }
    if (cancelled) {
      // An earlier cleanup may have seen no handle yet. Requeue this new generation even then.
      await tx
        .insert(workspaceTermination)
        .values({ workspaceId: values.id })
        .onConflictDoUpdate({
          target: workspaceTermination.workspaceId,
          set: { generation: randomUUID(), createdAt: new Date() },
        });
    }
    return { cancelled, workspace: updated!, volume: persistedVolume ?? null, publicationFailure };
  });
  // The teardown job must be committed before surfacing a publication failure to the caller.
  if (result.publicationFailure) throw result.publicationFailure.error;
  return result;
}
