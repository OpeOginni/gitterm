import { TRPCError } from "@trpc/server";
import z from "zod";
import { accountProcedure, router } from "../index";
import {
  cancelAgentRun,
  createAgentRun,
  getAgentRun,
  getAgentRunMessages,
} from "../service/agent-run";

const runTargetSchema = z.object({ workspaceId: z.uuid(), runId: z.uuid() });

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
  create: accountProcedure("run:write")
    .input(
      z.object({
        workspaceId: z.uuid(),
        idempotencyKey: z.string().trim().min(1).max(255),
        prompt: z.string().trim().min(1).max(100_000),
        title: z.string().trim().min(1).max(255).optional(),
        agent: z.string().trim().min(1).max(100).optional(),
        model: z.string().trim().min(3).max(255).optional(),
        waitForSetup: z.boolean().optional(),
        context: z
          .discriminatedUnion("type", [
            z.object({ type: z.literal("isolated") }).strict(),
            z.object({ type: z.literal("continue"), runId: z.uuid() }).strict(),
          ])
          .optional(),
        setupTimeoutMs: z
          .number()
          .int()
          .min(1_000)
          .max(10 * 60_000)
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      translateAgentError(() => createAgentRun(input, ctx.session.user.id)),
    ),

  get: accountProcedure("run:read")
    .input(runTargetSchema)
    .query(async ({ input, ctx }) =>
      translateAgentError(() => getAgentRun(input.workspaceId, input.runId, ctx.session.user.id)),
    ),

  messages: accountProcedure("run:read")
    .input(runTargetSchema)
    .query(async ({ input, ctx }) =>
      translateAgentError(() =>
        getAgentRunMessages(input.workspaceId, input.runId, ctx.session.user.id),
      ),
    ),

  cancel: accountProcedure("run:write")
    .input(runTargetSchema)
    .mutation(async ({ input, ctx }) =>
      translateAgentError(() =>
        cancelAgentRun(input.workspaceId, input.runId, ctx.session.user.id),
      ),
    ),
});
