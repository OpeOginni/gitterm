import { and, db, eq } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { TRPCError } from "@trpc/server";
import z from "zod";
import { protectedProcedure, router } from "../index";
import {
  cancelOpencodeRun,
  createOpencodeRun,
  getOpencodeRun,
  getOpencodeRunMessages,
} from "../service/agent-run/opencode";
import { resolveProjectDirectory } from "../service/workspace-runtime";
import { getWorkspaceUrl } from "../utils/routing";
import { decryptWorkspacePassword } from "../utils/workspace-password";

const runTargetSchema = z.object({ workspaceId: z.uuid(), runId: z.string().min(1).max(255) });

async function getRunTarget(workspaceId: string, userId: string) {
  const record = await db.query.workspace.findFirst({
    where: and(eq(workspace.id, workspaceId), eq(workspace.userId, userId)),
    with: { image: { with: { agentType: true } } },
  });
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  if (record.status !== "running" || !record.subdomain) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace must be running" });
  }
  if (record.image.agentType.provisionerKey !== "opencode") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Runs currently support OpenCode workspaces only",
    });
  }
  const [provider] = await db
    .select({ providerKey: cloudProvider.providerKey })
    .from(cloudProvider)
    .where(eq(cloudProvider.id, record.cloudProviderId));
  return {
    workspaceId: record.id,
    url: getWorkspaceUrl(record.subdomain),
    directory: resolveProjectDirectory(record.repositoryUrl, provider?.providerKey),
    password: record.serverPassword ? decryptWorkspacePassword(record.serverPassword) : null,
  };
}

async function translateAgentError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Agent request failed",
      cause: error,
    });
  }
}

export const runRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.uuid(),
        prompt: z.string().trim().min(1).max(100_000),
        title: z.string().trim().min(1).max(255).optional(),
        agent: z.string().trim().min(1).max(100).optional(),
        model: z.string().trim().min(3).max(255).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const target = await getRunTarget(input.workspaceId, ctx.session.user.id);
      return translateAgentError(() => createOpencodeRun({ ...target, ...input }));
    }),

  get: protectedProcedure.input(runTargetSchema).query(async ({ input, ctx }) => {
    const target = await getRunTarget(input.workspaceId, ctx.session.user.id);
    return translateAgentError(() => getOpencodeRun({ ...target, runId: input.runId }));
  }),

  messages: protectedProcedure.input(runTargetSchema).query(async ({ input, ctx }) => {
    const target = await getRunTarget(input.workspaceId, ctx.session.user.id);
    return translateAgentError(() => getOpencodeRunMessages({ ...target, runId: input.runId }));
  }),

  cancel: protectedProcedure.input(runTargetSchema).mutation(async ({ input, ctx }) => {
    const target = await getRunTarget(input.workspaceId, ctx.session.user.id);
    return translateAgentError(() => cancelOpencodeRun({ ...target, runId: input.runId }));
  }),
});
