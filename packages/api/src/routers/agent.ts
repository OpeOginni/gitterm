import z from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../index";
import { agentJWT } from "../service/tunnel/agent-jwt";
import { db, eq } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";

export const agentRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),

  // Used by the local agent/CLI once it has an agent access token.
  getSession: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ input }) => {
      let payload: { userId: string };
      try {
        payload = agentJWT.verifyToken(input.token);
      } catch (error) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: error instanceof Error ? error.message : "Invalid token",
        });
      }

      const [u] = await db.select().from(user).where(eq(user.id, payload.userId)).limit(1);
      if (!u) throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found" });

      return {
        userId: u.id,
        email: u.email,
        name: u.name,
      };
    }),
});
