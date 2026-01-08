import z from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../index";
import { db, eq } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import { tunnelJWT } from "../service/tunnel/tunnel-jwt";
import { agentJWT } from "../service/tunnel/agent-jwt";

export const tunnelRouter = router({
  mintToken: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const [ws] = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, input.workspaceId))
        .limit(1);

      if (!ws) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }

      if (ws.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
      }

      if (ws.hostingType !== "local") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Workspace is not a local tunnel workspace",
        });
      }

      const tokenExposedPorts: Record<string, number> = {};
      if (ws.localPort) tokenExposedPorts.root = ws.localPort;
      for (const [serviceName, entry] of Object.entries(ws.exposedPorts ?? {})) {
        tokenExposedPorts[serviceName] = entry.port;
      }

      const token = tunnelJWT.generateToken({
        workspaceId: ws.id,
        userId,
        subdomain: ws.subdomain ?? "",
        scopes: ["tunnel:connect"],
        exposedPorts: tokenExposedPorts,
      });

      return {
        token,
        expiresInSeconds: 10 * 60,
        subdomain: ws.subdomain,
        workspaceId: ws.id,
        userId,
      };
    }),

  // Mint a tunnel token using an agent access token (device-code flow).
  mintTokenWithAgentToken: publicProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        agentToken: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      let payload: { userId: string };
      try {
        payload = agentJWT.verifyToken(input.agentToken);
      } catch (error) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: error instanceof Error ? error.message : "Invalid token",
        });
      }

      const userId = payload.userId;
      const [ws] = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, input.workspaceId))
        .limit(1);

      if (!ws) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }

      if (ws.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
      }

      if (ws.hostingType !== "local") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Workspace is not a local tunnel workspace",
        });
      }

      const tokenExposedPorts: Record<string, number> = {};
      if (ws.localPort) tokenExposedPorts.root = ws.localPort;
      for (const [serviceName, entry] of Object.entries(ws.exposedPorts ?? {})) {
        tokenExposedPorts[serviceName] = entry.port;
      }

      const token = tunnelJWT.generateToken({
        workspaceId: ws.id,
        userId,
        subdomain: ws.subdomain ?? "",
        scopes: ["tunnel:connect"],
        exposedPorts: tokenExposedPorts,
      });

      return {
        token,
        expiresInSeconds: 10 * 60,
        subdomain: ws.subdomain,
        workspaceId: ws.id,
        userId,
      };
    }),
});
