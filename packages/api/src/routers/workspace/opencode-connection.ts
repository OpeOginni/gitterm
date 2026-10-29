import { and, db, eq } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import { createOpencodeConnection } from "@gitterm/agent-runtime/pairing";
import { RuntimeHttpError } from "@gitterm/agent-runtime/http";
import { TRPCError } from "@trpc/server";
import z from "zod";
import { protectedProcedure } from "../../index";
import { getWorkspaceUrl } from "../../utils/routing";
import { decryptWorkspacePassword } from "../../utils/workspace-password";

export const opencodeConnectionProcedures = {
  createOpencodeConnection: protectedProcedure
    .input(z.object({ workspaceId: z.uuid(), kind: z.enum(["link", "tui"]) }))
    .mutation(async ({ ctx, input }) => {
      ctx.honoContext.header("Cache-Control", "no-store, private");
      const record = await db.query.workspace.findFirst({
        where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, ctx.session.user.id)),
        with: { image: { with: { agentType: true } } },
      });
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      if (record.image.agentType.provisionerKey !== "opencode" || !record.serverOnly) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Pairing requires an OpenCode server workspace",
        });
      }
      if (record.status !== "running" || !record.subdomain || !record.serverPassword) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The workspace must be running and have a server credential",
        });
      }
      const url = getWorkspaceUrl(record.subdomain);
      if (input.kind === "link" && new URL(url).pathname !== "/") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Pairing links require a workspace subdomain. Use the server URL and password instead.",
        });
      }
      try {
        return await createOpencodeConnection(
          { url, password: decryptWorkspacePassword(record.serverPassword, record) },
          input.kind,
        );
      } catch (error) {
        // Never surface the upstream body: it may contain credentials or a provider's error page.
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            error instanceof RuntimeHttpError && error.status === 404
              ? "This server does not support pairing yet. Update OpenCode, or use the server URL and password."
              : "Could not create an OpenCode connection. Try again, or use the server URL and password.",
        });
      }
    }),
};
