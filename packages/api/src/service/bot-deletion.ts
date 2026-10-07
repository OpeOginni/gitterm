import { and, db, eq, inArray, ne, or, isNotNull, sql } from "@gitterm/db";
import { apiToken } from "@gitterm/db/schema/auth";
import { bot } from "@gitterm/db/schema/bot";
import { workspace, workspaceTermination } from "@gitterm/db/schema/workspace";
import { TRPCError } from "@trpc/server";

/** Revoke the bot and persist teardown intent in the same commit, before any remote work. */
export async function requestBotDeletion(userId: string, botId: string) {
  return db.transaction(async (tx) => {
    const [identity] = await tx
      .select()
      .from(bot)
      .where(and(eq(bot.id, botId), eq(bot.userId, userId)))
      .for("update");

    // A retry after the bot was removed may still finish its owned workspaces' cleanup.
    if (!identity) {
      const [owned] = await tx
        .select({ id: workspace.id })
        .from(workspace)
        .where(and(eq(workspace.userId, userId), eq(workspace.botId, botId)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Bot not found" });
    }

    const sandboxes = await tx
      .select({ id: workspace.id })
      .from(workspace)
      .leftJoin(workspaceTermination, eq(workspaceTermination.workspaceId, workspace.id))
      .where(
        and(
          eq(workspace.userId, userId),
          eq(workspace.botId, botId),
          or(
            ne(workspace.status, "terminated"),
            ne(workspace.externalInstanceId, ""),
            isNotNull(workspaceTermination.workspaceId),
          ),
        ),
      );
    const ids = sandboxes.map(({ id }) => id);
    if (ids.length) {
      await tx
        .insert(workspaceTermination)
        .values(ids.map((workspaceId) => ({ workspaceId })))
        .onConflictDoNothing();
      // Fence access and provisioning immediately; remote failure must not leave an active bot.
      await tx
        .update(workspace)
        .set({
          status: "terminated",
          authVersion: sql`${workspace.authVersion} + 1`,
          pausedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(workspace.id, ids));
    }
    if (identity) {
      await tx.update(apiToken).set({ revokedAt: new Date() }).where(eq(apiToken.botId, botId));
      await tx.delete(bot).where(eq(bot.id, botId));
    }
    return ids;
  });
}
