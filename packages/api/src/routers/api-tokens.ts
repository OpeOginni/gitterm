import z from "zod";
import { TRPCError } from "@trpc/server";
import { db, eq } from "@gitterm/db";
import { bot } from "@gitterm/db/schema/bot";
import { sessionProcedure, router } from "../index";
import { createApiToken, listApiTokens, revokeApiToken } from "../service/auth/api-token";
import { apiTokenScopesSchema } from "@gitterm/schema";

/**
 * User API token (personal access token) management.
 *
 * Session-only on purpose: an API token must never be able to create or
 * manage other API tokens (same escalation rule as device.approve).
 */
export const apiTokensRouter = router({
  create: sessionProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        scopes: apiTokenScopesSchema,
        // null/undefined = no expiry; capped at one year
        expiresInDays: z.number().int().min(1).max(365).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { token, record } = await createApiToken({
          userId: ctx.session.user.id,
          name: input.name,
          scopes: input.scopes,
          expiresInDays: input.expiresInDays,
        });

        // The plaintext token is returned exactly once and never stored.
        return { token, record };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create API token",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  list: sessionProcedure.query(async ({ ctx }) => {
    try {
      const userId = ctx.session.user.id;
      const [tokens, bots] = await Promise.all([
        listApiTokens(userId),
        db
          .select({ id: bot.id, platform: bot.platform, apiTokenId: bot.apiTokenId })
          .from(bot)
          .where(eq(bot.userId, userId)),
      ]);
      // A bot's token links back to the bot it runs.
      const botOf = new Map(bots.map(({ apiTokenId, ...rest }) => [apiTokenId, rest]));
      return { tokens: tokens.map((token) => ({ ...token, bot: botOf.get(token.id) ?? null })) };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to list API tokens",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  revoke: sessionProcedure
    .input(z.object({ tokenId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const revoked = await revokeApiToken({
        userId: ctx.session.user.id,
        tokenId: input.tokenId,
      });

      if (!revoked) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API token not found",
        });
      }

      return { success: true };
    }),
});
