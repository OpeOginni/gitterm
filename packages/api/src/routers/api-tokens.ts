import z from "zod";
import { TRPCError } from "@trpc/server";
import { sessionProcedure, router } from "../index";
import { createApiToken, listApiTokens, revokeApiToken } from "../service/auth/api-token";

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
        // null/undefined = no expiry; capped at one year
        expiresInDays: z.number().int().min(1).max(365).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { token, record } = await createApiToken({
          userId: ctx.session.user.id,
          name: input.name,
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
      return { tokens: await listApiTokens(ctx.session.user.id) };
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
