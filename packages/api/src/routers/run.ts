import { on } from "node:events";
import { TRPCError } from "@trpc/server";
import z from "zod";
import { accountProcedure, router } from "../index";
import { RUN_LIFECYCLE_EVENTS, type RunEvent } from "../events/run-lifecycle";
import {
  cancelAgentRun,
  createAgentRun,
  getAgentRun,
  getAgentRunMessages,
  listAgentRuns,
  respondToAgentRun,
} from "../service/agent-run";
import { isTerminalRunStatus } from "../service/agent-run/runtime";

const runTargetSchema = z.object({ workspaceId: z.uuid(), runId: z.uuid() });

const runReplySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("permission"), response: z.enum(["once", "always", "reject"]) }),
  z.object({
    type: z.literal("question"),
    /** One entry per question, each the selected option labels (or a custom answer). */
    answers: z.array(z.array(z.string().max(10_000)).max(50)).max(50),
  }),
  z.object({ type: z.literal("question"), reject: z.literal(true) }),
]);

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
        /** How long to wait for a `pending` workspace to become `running` before failing. */
        startTimeoutMs: z.number().int().min(1_000).max(240_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      translateAgentError(() => createAgentRun(input, ctx.session.user.id)),
    ),

  list: accountProcedure("run:read")
    .input(
      z.object({
        workspaceId: z.uuid(),
        status: z.enum(["all", "active", "terminal"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .query(async ({ input, ctx }) =>
      translateAgentError(() =>
        listAgentRuns(input.workspaceId, ctx.session.user.id, {
          status: input.status ?? "all",
          limit: input.limit ?? 20,
          offset: input.offset ?? 0,
        }),
      ),
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

  respond: accountProcedure("run:write")
    .input(runTargetSchema.extend({ requestId: z.string().min(1).max(255), reply: runReplySchema }))
    .mutation(async ({ input, ctx }) =>
      translateAgentError(() => respondToAgentRun(input, ctx.session.user.id)),
    ),

  cancel: accountProcedure("run:write")
    .input(runTargetSchema)
    .mutation(async ({ input, ctx }) =>
      translateAgentError(() =>
        cancelAgentRun(input.workspaceId, input.runId, ctx.session.user.id),
      ),
    ),

  /** Lifecycle only; detailed OpenCode events come from `getRuntimeAccess`. */
  lifecycle: accountProcedure("run:read")
    .input(runTargetSchema)
    .subscription(async function* ({ input, ctx, signal }) {
      // Listen before reading the row so nothing published in between is lost.
      RUN_LIFECYCLE_EVENTS.bridge();
      const iterable = on(RUN_LIFECYCLE_EVENTS.emitter, input.runId, {
        signal,
      }) as AsyncIterableIterator<[RunEvent]>;
      try {
        const run = await translateAgentError(() =>
          getAgentRun(input.workspaceId, input.runId, ctx.session.user.id),
        );
        yield { type: "snapshot" as const, run };
        if (isTerminalRunStatus(run.status)) return;

        for await (const [event] of iterable) {
          yield event;
          if (isTerminalRunStatus(event.run.status)) return;
        }
      } finally {
        await iterable.return?.();
      }
    }),
});
