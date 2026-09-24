import { randomUUID } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { TRPCError } from "@trpc/server";
import { and, db, eq } from "@gitterm/db";
import { githubPatConnection } from "@gitterm/db/schema/integrations";
import z from "zod";
import { protectedProcedure, router } from "../../index";
import { EncryptionService } from "../../service/encryption";
import { integrationPolicy } from "../../service/integrations/catalog";

const inputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  token: z
    .string()
    .trim()
    .min(20)
    .max(4096)
    .regex(/^[^\s]+$/, "Token cannot contain whitespace"),
});

function publicPat(row: typeof githubPatConnection.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    accountLogin: row.accountLogin,
    tokenSuffix: row.tokenSuffix,
    createdAt: row.createdAt,
  };
}

export const githubPatRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!(await integrationPolicy("github")).enabled) return [];
    return (
      await db
        .select()
        .from(githubPatConnection)
        .where(eq(githubPatConnection.userId, ctx.session.user.id))
    ).map(publicPat);
  }),
  create: protectedProcedure.input(inputSchema).mutation(async ({ ctx, input }) => {
    if (!(await integrationPolicy("github")).enabled) {
      throw new TRPCError({ code: "FORBIDDEN", message: "GitHub repository access is disabled" });
    }
    let accountLogin: string;
    try {
      const { data } = await new Octokit({ auth: input.token }).users.getAuthenticated();
      accountLogin = data.login;
    } catch {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "GitHub could not authenticate this personal access token",
      });
    }
    const id = randomUUID();
    const [row] = await db
      .insert(githubPatConnection)
      .values({
        id,
        userId: ctx.session.user.id,
        name: input.name,
        accountLogin,
        encryptedToken: new EncryptionService().encrypt(input.token, `github:pat:${id}`),
        tokenSuffix: input.token.slice(-4),
      })
      .returning();
    return publicPat(row!);
  }),
  remove: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const [removed] = await db
      .delete(githubPatConnection)
      .where(
        and(
          eq(githubPatConnection.id, input.id),
          eq(githubPatConnection.userId, ctx.session.user.id),
        ),
      )
      .returning({ id: githubPatConnection.id });
    if (!removed)
      throw new TRPCError({ code: "NOT_FOUND", message: "GitHub token connection not found" });
    return { success: true };
  }),
});
