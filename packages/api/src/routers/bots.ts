import z from "zod";
import { TRPCError } from "@trpc/server";
import { and, db, desc, eq } from "@gitterm/db";
import { apiToken } from "@gitterm/db/schema/auth";
import { bot } from "@gitterm/db/schema/bot";
import {
  BOT_TOKEN_SCOPES,
  botChannelSchema,
  botSettingsSchema,
  type BotSettings,
} from "@gitterm/schema";
import { accountProcedure, router, sessionProcedure } from "../index";
import { createApiToken, revokeApiToken } from "../service/auth/api-token";

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
const mintToken = (userId: string, name: string) =>
  createApiToken({ userId, name: `${name} (bot)`, scopes: BOT_TOKEN_SCOPES, expiresInDays: 365 });

/**
 * Saved chat bots. The dashboard manages them with a session; a running bot reads its own
 * settings with its API token (`self`), so its .env holds only secrets.
 */
export const botsRouter = router({
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
    return { ...settingsOf(row), knownChannels: row.knownChannels ?? [] };
  }),

  /** Saves the bot and mints its token, returned once. */
  create: sessionProcedure.input(botSettingsSchema).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const { token, record } = await mintToken(userId, input.name);
    const [row] = await db
      .insert(bot)
      .values({ ...input, userId, apiTokenId: record.id })
      .returning();
    return { bot: settingsOf(row!), token };
  }),

  /** Takes effect when the bot next starts. */
  update: sessionProcedure
    .input(botSettingsSchema.extend({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...settings } = input;
      await ownBot(ctx.session.user.id, id);
      const [row] = await db
        .update(bot)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(bot.id, id))
        .returning();
      return settingsOf(row!);
    }),

  /** A new token for the bot; the old one stops working. */
  rotateToken: sessionProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const row = await ownBot(userId, input.id);
      const { token, record } = await mintToken(userId, row.name);
      await db
        .update(bot)
        .set({ apiTokenId: record.id, updatedAt: new Date() })
        .where(eq(bot.id, row.id));
      if (row.apiTokenId) await revokeApiToken({ userId, tokenId: row.apiTokenId });
      return { token };
    }),

  /** Deletes the bot and revokes its token. Its sandboxes stay until terminated. */
  delete: sessionProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const row = await ownBot(userId, input.id);
    await db.delete(bot).where(eq(bot.id, row.id));
    if (row.apiTokenId) await revokeApiToken({ userId, tokenId: row.apiTokenId });
    return { success: true };
  }),

  /** The running bot lists the channels it's in, so the dashboard can offer them as choices. */
  reportChannels: accountProcedure("identity:read")
    .input(z.object({ channels: z.array(botChannelSchema).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.authMethod !== "apiToken" || !ctx.apiTokenId) return { saved: false };
      const updated = await db
        .update(bot)
        .set({ knownChannels: input.channels })
        .where(and(eq(bot.apiTokenId, ctx.apiTokenId), eq(bot.userId, ctx.session.user.id)))
        .returning({ id: bot.id });
      return { saved: updated.length > 0 };
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
