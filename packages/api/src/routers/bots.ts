import z from "zod";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, db, desc, eq } from "@gitterm/db";
import { apiToken } from "@gitterm/db/schema/auth";
import { bot } from "@gitterm/db/schema/bot";
import { BOT_TOKEN_SCOPES, botSettingsSchema, type BotSettings } from "@gitterm/schema";
import { accountProcedure, router, sessionProcedure } from "../index";
import { createApiToken } from "../service/auth/api-token";
import { coordinate } from "../service/coordination";

type BotRow = typeof bot.$inferSelect;

const settingsOf = (row: BotRow): BotSettings & { id: string } => ({
  id: row.id,
  name: row.name,
  platform: row.platform as BotSettings["platform"],
  repo: row.repo,
  model: row.model,
  credential: row.credential,
  connections: row.connections,
  provider: row.provider,
  githubAccess: row.githubAccess as BotSettings["githubAccess"],
  channels: row.channels,
  allowedUsers: row.allowedUsers,
  allowGuests: row.allowGuests,
  instructions: row.instructions,
  setup: row.setup,
});

async function ownBot(userId: string, id: string): Promise<BotRow> {
  const [row] = await db
    .select()
    .from(bot)
    .where(and(eq(bot.id, id), eq(bot.userId, userId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Bot not found" });
  return row;
}

/** A new token for the bot; the plaintext is returned once and never stored. */
const mintToken = (
  userId: string,
  name: string,
  botId: string,
  executor: Pick<typeof db, "insert">,
) =>
  createApiToken(
    { userId, name: `${name} (bot)`, botId, scopes: BOT_TOKEN_SCOPES, expiresInDays: 365 },
    executor,
  );

/**
 * Saved chat bots. The dashboard manages them with a session; a running bot reads its own
 * settings with its API token (`self`), so its .env holds only secrets.
 */
export const botsRouter = router({
  /** Distributed singleton; renewal is fenced by a random deployment id. */
  acquireLease: accountProcedure("identity:read")
    .input(z.object({ leaseId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.botIdentity)
        throw new TRPCError({ code: "FORBIDDEN", message: "Saved bot token required" });
      const claimed = await coordinate((repository) =>
        repository.claimBot(ctx.botIdentity!.id, ctx.apiTokenId!, input.leaseId),
      );
      if (!claimed)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Another process owns this bot's runtime lease",
        });
      return { success: true as const };
    }),
  releaseLease: accountProcedure("identity:read")
    .input(z.object({ leaseId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.botIdentity)
        throw new TRPCError({ code: "FORBIDDEN", message: "Saved bot token required" });
      await coordinate((repository) =>
        repository.releaseBot(ctx.botIdentity!.id, ctx.apiTokenId!, input.leaseId),
      );
      return { success: true as const };
    }),
  list: sessionProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({ bot, token: apiToken })
      .from(bot)
      .leftJoin(apiToken, eq(bot.apiTokenId, apiToken.id))
      .where(eq(bot.userId, ctx.session.user.id))
      .orderBy(desc(bot.createdAt));
    return rows.map(({ bot: row, token }) => ({
      ...settingsOf(row),
      createdAt: row.createdAt,
      token: token
        ? {
            prefix: token.tokenPrefix,
            lastUsedAt: token.lastUsedAt,
            expiresAt: token.expiresAt,
            revoked: Boolean(token.revokedAt),
          }
        : null,
    }));
  }),

  get: sessionProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const row = await ownBot(ctx.session.user.id, input.id);
    return settingsOf(row);
  }),

  /** Saves the bot and mints its token, returned once. */
  create: sessionProcedure.input(botSettingsSchema).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    return db.transaction(async (tx) => {
      const id = randomUUID();
      const { token, record } = await mintToken(userId, input.name, id, tx);
      const [row] = await tx
        .insert(bot)
        .values({ ...input, id, userId, apiTokenId: record.id })
        .returning();
      return { bot: settingsOf(row!), token };
    });
  }),

  /** Takes effect when the bot next starts. */
  update: sessionProcedure
    .input(botSettingsSchema.extend({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...settings } = input;
      const [row] = await db
        .update(bot)
        .set({ ...settings, updatedAt: new Date() })
        .where(and(eq(bot.id, id), eq(bot.userId, ctx.session.user.id)))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Bot not found" });
      return settingsOf(row);
    }),

  /** A new token for the bot; the old one stops working. */
  rotateToken: sessionProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const result = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(bot)
          .where(and(eq(bot.id, input.id), eq(bot.userId, userId)))
          .for("update");
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Bot not found" });
        await tx.update(apiToken).set({ revokedAt: new Date() }).where(eq(apiToken.botId, row.id));
        const { token, record } = await mintToken(userId, row.name, row.id, tx);
        await tx
          .update(bot)
          .set({ apiTokenId: record.id, updatedAt: new Date() })
          .where(eq(bot.id, row.id));
        return { token, previousTokenId: row.apiTokenId };
      });
      if (result.previousTokenId)
        await coordinate((repository) =>
          repository.revokeBot(input.id, result.previousTokenId!),
        ).catch(() => undefined);
      return { token: result.token };
    }),

  /** Deletes the bot and revokes its token. Its sandboxes stay until terminated. */
  delete: sessionProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(bot)
        .where(and(eq(bot.id, input.id), eq(bot.userId, userId)))
        .for("update");
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Bot not found" });
      await tx.update(apiToken).set({ revokedAt: new Date() }).where(eq(apiToken.botId, row.id));
      await tx.delete(bot).where(eq(bot.id, row.id));
      return { success: true };
    });
  }),

  /** The calling bot's settings, found by its API token; null for any other caller. */
  self: accountProcedure("identity:read").query(async ({ ctx }) => {
    if (ctx.authMethod !== "apiToken" || !ctx.apiTokenId) return null;
    const [row] = await db
      .select()
      .from(bot)
      .where(and(eq(bot.apiTokenId, ctx.apiTokenId), eq(bot.userId, ctx.session.user.id)))
      .limit(1);
    return row ? settingsOf(row) : null;
  }),
});
