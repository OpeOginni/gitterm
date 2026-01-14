import z from "zod";
import { protectedProcedure, router } from "../../index";
import { db, eq, and, desc, asc, sql } from "@gitterm/db";
import {
  agentLoop,
  agentLoopRun,
  type AgentLoopStatus,
  type AgentLoopRunStatus,
  userLoopRunQuota,
} from "@gitterm/db/schema/agent-loop";
import { gitIntegration } from "@gitterm/db/schema/integrations";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { AGENT_LOOP_RUN_TIMEOUT_MS } from "../../config/agent-loop";
import { TRPCError } from "@trpc/server";
import { getAgentLoopService } from "../../service/agent-loop";
import { deductRunFromQuota, refundRunToQuota } from "../../service/run-quota";
import { getModelConfig, getCredentialForRun } from "../../service/agent-loop-helpers";
import { MONTHLY_RUN_QUOTAS } from "../../config";
import { addMonths } from "date-fns";

export const agentLoopCreateSchema = z.object({
  gitIntegrationId: z.uuid(),
  sandboxProviderId: z.uuid(),
  repositoryOwner: z.string().min(1),
  repositoryName: z.string().min(1),
  branch: z.string().min(1).default("main"),
  planFilePath: z.string().min(1),
  progressFilePath: z.string().optional(),
  automationEnabled: z.boolean().default(false),
  maxRuns: z.number().min(1).max(20).default(5),
  modelProviderId: z.uuid(), // FK to model_provider table
  modelId: z.uuid(), // FK to model table
  credentialId: z.uuid().optional(), // FK to user_model_credential table (required for automated runs)
  prompt: z.string().optional(),
});

export const agentLoopRouter = router({
  /**
   * Create a new agent loop
   */
  createLoop: protectedProcedure.input(agentLoopCreateSchema).mutation(async ({ input, ctx }) => {
    const userId = ctx.session.user.id;

    // Verify git integration belongs to user
    const [integration] = await db
      .select()
      .from(gitIntegration)
      .where(and(eq(gitIntegration.id, input.gitIntegrationId), eq(gitIntegration.userId, userId)));

    if (!integration) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Git integration not found",
      });
    }

    // Get the Cloudflare sandbox provider
    const [sandboxProvider] = await db
      .select()
      .from(cloudProvider)
      .where(eq(cloudProvider.id, input.sandboxProviderId));

    if (!sandboxProvider) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No sandbox provider configured. Please contact support.",
      });
    }

    const existingQuota = await db.query.userLoopRunQuota.findFirst({
      where: eq(userLoopRunQuota.userId, userId),
    });

    if (!existingQuota) {
      const plan = ctx.session.user.plan ?? "free";
      const [newQuota] = await db.insert(userLoopRunQuota).values({
        userId,
        plan: plan,
        monthlyRuns: MONTHLY_RUN_QUOTAS[plan],
        extraRuns: 0,
        nextMonthlyResetAt: addMonths(new Date(), 1),
      })
      .returning();
      if(!newQuota) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create user loop run quota",
        });
      }

      if(newQuota.monthlyRuns < input.maxRuns) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Not enough runs available. Please lower your max runs or upgrade your plan.",
        });
      }
    } else {
      // Reset monthly runs if the billing period has ended
      if(existingQuota.nextMonthlyResetAt < new Date()) {
        const [updatedQuota] = await db.update(userLoopRunQuota).set({
          monthlyRuns: MONTHLY_RUN_QUOTAS[ctx.session.user.plan ?? "free"],
          nextMonthlyResetAt: addMonths(new Date(), 1),
        }).where(eq(userLoopRunQuota.userId, userId)).returning();
        if(!updatedQuota) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update user loop run quota",
          });
        }
      }

      // Check if the user has enough runs available
      if(existingQuota.monthlyRuns + existingQuota.extraRuns < input.maxRuns) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Not enough runs available. Please lower your max runs or upgrade your plan.",
        });
      }
    }

    // Create the loop
    const [newLoop] = await db
      .insert(agentLoop)
      .values({
        userId,
        gitIntegrationId: input.gitIntegrationId,
        sandboxProviderId: sandboxProvider.id,
        repositoryOwner: input.repositoryOwner,
        repositoryName: input.repositoryName,
        branch: input.branch,
        planFilePath: input.planFilePath,
        progressFilePath: input.progressFilePath,
        modelProviderId: input.modelProviderId,
        modelId: input.modelId,
        credentialId: input.credentialId,
        automationEnabled: input.automationEnabled,
        maxRuns: input.maxRuns,
        prompt: input.prompt,
      })
      .returning();

    return {
      success: true,
      loop: newLoop,
    };
  }),

  /**
   * List all loops for the authenticated user
   */
  listLoops: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(["all", "active", "paused", "completed", "archived"]).default("all"),
          limit: z.number().min(1).max(100).default(20),
          offset: z.number().min(0).default(0),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { status = "all", limit = 20, offset = 0 } = input ?? {};

      const whereCondition =
        status === "all"
          ? eq(agentLoop.userId, userId)
          : and(eq(agentLoop.userId, userId), eq(agentLoop.status, status as AgentLoopStatus));

      const loops = await db.query.agentLoop.findMany({
        where: whereCondition,
        with: {
          gitIntegration: true,
          sandboxProvider: true,
          modelProvider: true,
          model: true,
        },
        orderBy: [desc(agentLoop.createdAt)],
        limit,
        offset,
      });

      // Get total count using efficient COUNT query
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(agentLoop)
        .where(whereCondition);

      const total = Number(countResult?.count ?? 0);

      return {
        success: true,
        loops,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + loops.length < total,
        },
      };
    }),

  /**
   * Get a single loop with its runs
   */
  getLoop: protectedProcedure
    .input(z.object({ loopId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const loop = await db.query.agentLoop.findFirst({
        where: and(eq(agentLoop.id, input.loopId), eq(agentLoop.userId, userId)),
        with: {
          gitIntegration: true,
          sandboxProvider: true,
          modelProvider: true,
          model: true,
          runs: {
            orderBy: [asc(agentLoopRun.runNumber)],
            limit: 50, // Last 50 runs
            with: {
              model: true,
            },
          },
        },
      });

      if (!loop) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Loop not found",
        });
      }

      return {
        success: true,
        loop,
      };
    }),

  /**
   * Update loop settings
   */
  updateLoop: protectedProcedure
    .input(
      z.object({
        loopId: z.uuid(),
        planFilePath: z.string().min(1).optional(),
        progressFilePath: z.string().optional(),
        automationEnabled: z.boolean().optional(),
        maxRuns: z.number().min(1).max(100).optional(),
        modelProviderId: z.uuid().optional(),
        modelId: z.uuid().optional(),
        credentialId: z.uuid().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      // Verify loop belongs to user
      const [existingLoop] = await db
        .select()
        .from(agentLoop)
        .where(and(eq(agentLoop.id, input.loopId), eq(agentLoop.userId, userId)));

      if (!existingLoop) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Loop not found",
        });
      }

      // Build update object
      const updates: Partial<typeof agentLoop.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.planFilePath !== undefined) updates.planFilePath = input.planFilePath;
      if (input.progressFilePath !== undefined) updates.progressFilePath = input.progressFilePath;
      if (input.automationEnabled !== undefined)
        updates.automationEnabled = input.automationEnabled;
      if (input.maxRuns !== undefined) updates.maxRuns = input.maxRuns;
      if (input.modelProviderId !== undefined) updates.modelProviderId = input.modelProviderId;
      if (input.modelId !== undefined) updates.modelId = input.modelId;
      if (input.credentialId !== undefined) updates.credentialId = input.credentialId;

      const [updatedLoop] = await db
        .update(agentLoop)
        .set(updates)
        .where(eq(agentLoop.id, input.loopId))
        .returning();

      return {
        success: true,
        loop: updatedLoop,
      };
    }),

  /**
   * Pause a loop (stops automation)
   */
  pauseLoop: protectedProcedure
    .input(z.object({ loopId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const [existingLoop] = await db
        .select()
        .from(agentLoop)
        .where(and(eq(agentLoop.id, input.loopId), eq(agentLoop.userId, userId)));

      if (!existingLoop) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Loop not found",
        });
      }

      if (existingLoop.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only active loops can be paused",
        });
      }

      const [updatedLoop] = await db
        .update(agentLoop)
        .set({
          status: "paused",
          updatedAt: new Date(),
        })
        .where(eq(agentLoop.id, input.loopId))
        .returning();

      return {
        success: true,
        loop: updatedLoop,
      };
    }),

  /**
   * Resume a paused loop
   */
  resumeLoop: protectedProcedure
    .input(z.object({ loopId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const [existingLoop] = await db
        .select()
        .from(agentLoop)
        .where(and(eq(agentLoop.id, input.loopId), eq(agentLoop.userId, userId)));

      if (!existingLoop) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Loop not found",
        });
      }

      if (existingLoop.status !== "paused") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only paused loops can be resumed",
        });
      }

      const [updatedLoop] = await db
        .update(agentLoop)
        .set({
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(agentLoop.id, input.loopId))
        .returning();

      return {
        success: true,
        loop: updatedLoop,
      };
    }),

  /**
   * Archive a loop (soft delete)
   */
  archiveLoop: protectedProcedure
    .input(z.object({ loopId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const [existingLoop] = await db
        .select()
        .from(agentLoop)
        .where(and(eq(agentLoop.id, input.loopId), eq(agentLoop.userId, userId)));

      if (!existingLoop) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Loop not found",
        });
      }

      // Cancel any running/pending runs before archiving
      await db
        .update(agentLoopRun)
        .set({ status: "cancelled" })
        .where(and(eq(agentLoopRun.loopId, input.loopId), eq(agentLoopRun.status, "pending")));

      const [updatedLoop] = await db
        .update(agentLoop)
        .set({
          status: "archived",
          updatedAt: new Date(),
        })
        .where(eq(agentLoop.id, input.loopId))
        .returning();

      return {
        success: true,
        loop: updatedLoop,
      };
    }),

  /**
   * Delete a loop permanently (runs are cascade deleted)
   */
  deleteLoop: protectedProcedure
    .input(z.object({ loopId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const [existingLoop] = await db
        .select()
        .from(agentLoop)
        .where(and(eq(agentLoop.id, input.loopId), eq(agentLoop.userId, userId)));

      if (!existingLoop) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Loop not found",
        });
      }

      // Delete the loop (runs are cascade deleted automatically)
      await db
        .delete(agentLoop)
        .where(eq(agentLoop.id, input.loopId));

      return {
        success: true,
      };
    }),

  /**
   * Mark a loop as completed
   */
  completeLoop: protectedProcedure
    .input(z.object({ loopId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const [existingLoop] = await db
        .select()
        .from(agentLoop)
        .where(and(eq(agentLoop.id, input.loopId), eq(agentLoop.userId, userId)));

      if (!existingLoop) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Loop not found",
        });
      }

      const [updatedLoop] = await db
        .update(agentLoop)
        .set({
          status: "completed",
          updatedAt: new Date(),
        })
        .where(eq(agentLoop.id, input.loopId))
        .returning();

      return {
        success: true,
        loop: updatedLoop,
      };
    }),

  /**
   * Start a new run (manual trigger)
   * This is an atomic operation that creates and executes the run in one step.
   * If execution fails, the run is marked as failed (no zombie pending runs).
   * Automatically finds the user's credential for the loop's provider.
   */
  startRun: protectedProcedure
    .input(z.object({ 
      loopId: z.uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      // Get the loop with model info
      const [loop] = await db
        .select()
        .from(agentLoop)
        .where(and(eq(agentLoop.id, input.loopId), eq(agentLoop.userId, userId)));

      if (!loop) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Loop not found",
        });
      }

      if (loop.status === "archived") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot start runs on archived loops",
        });
      }

      if (loop.status === "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Loop is completed. Resume it first to start new runs.",
        });
      }

      if (loop.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Loop must be active to start a run",
        });
      }

      // Check if there's already a running/pending run
      const [existingRun] = await db
        .select()
        .from(agentLoopRun)
        .where(and(eq(agentLoopRun.loopId, input.loopId), eq(agentLoopRun.status, "running")));

      if (existingRun) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A run is already in progress for this loop",
        });
      }

      // Check max runs limit
      if (loop.totalRuns >= loop.maxRuns) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Maximum runs limit (${loop.maxRuns}) reached`,
        });
      }

      // Get model config
      const { providerRecord, modelRecord } = await getModelConfig(loop);

      // Create new run first
      const runNumber = loop.totalRuns + 1;
      const [newRun] = await db
        .insert(agentLoopRun)
        .values({
          loopId: input.loopId,
          runNumber,
          status: "pending",
          triggerType: "manual",
          modelProviderId: loop.modelProviderId,
          modelId: loop.modelId,
        })
        .returning();

      if (!newRun) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create new run",
        });
      }

      // Deduct run from user quota and record event
      // For manual runs, throw error on failure (don't halt)
      try {
        await deductRunFromQuota(userId, input.loopId, newRun.id, {
          haltOnExhaustion: false, // Throw error instead of halting
          allowMissingQuota: false,
        });
      } catch (error) {
        // If quota deduction fails, delete the run and rethrow the error
        await db.delete(agentLoopRun).where(eq(agentLoopRun.id, newRun.id));
        throw error;
      }

      // Get credential for the run
      const credential = await getCredentialForRun(
        userId,
        input.loopId,
        newRun.id,
        loop,
        providerRecord,
        modelRecord,
      );

      // Execute the run immediately
      const service = getAgentLoopService();
      const result = await service.startRunAsync({
        loopId: input.loopId,
        runId: newRun.id,
        provider: providerRecord.name,
        modelId: modelRecord.modelId,
        credential,
        prompt: loop.prompt || undefined,
      });

      if (!result.success) {
        // Refund the run since it failed to start
        try {
          await refundRunToQuota(userId, input.loopId, newRun.id);
        } catch (error) {
          // Log but don't fail - the run is already marked as failed
          console.error("Failed to refund run quota", error);
        }

        // Mark run as failed instead of leaving it as zombie pending
        await db
          .update(agentLoopRun)
          .set({
            status: "failed",
            completedAt: new Date(),
            errorMessage: result.error || "Failed to start sandbox",
          })
          .where(eq(agentLoopRun.id, newRun.id));

        // Update loop's failed count (but don't increment totalRuns since run failed)
        await db
          .update(agentLoop)
          .set({
            failedRuns: loop.failedRuns + 1,
          })
          .where(eq(agentLoop.id, input.loopId));

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error || "Failed to start run",
        });
      }

      // Update loop run count after successful start
      await db
        .update(agentLoop)
        .set({
          totalRuns: loop.totalRuns + 1,
          lastRunId: newRun.id,
        })
        .where(eq(agentLoop.id, input.loopId));

      return {
        success: true,
        run: newRun,
        runId: result.runId,
        sandboxId: result.sandboxId,
        message: `Run #${runNumber} started successfully`,
        async: result.async,
      };
    }),

  restartRun: protectedProcedure
    .input(z.object({ loopId: z.uuid(), runId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const [loop] = await db
        .select()
        .from(agentLoop)
        .where(and(eq(agentLoop.id, input.loopId), eq(agentLoop.userId, userId)));

      if (!loop) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Loop not found",
        });
      }

      const [existingRun] = await db
        .select()
        .from(agentLoopRun)
        .where(and(eq(agentLoopRun.id, input.runId), eq(agentLoopRun.loopId, input.loopId)));

      if (!existingRun) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Run not found",
        });
      }

      // Only allow restarting stalled runs (running for longer than the timeout) or halted runs
      const isStalled = (existingRun.status === "running" || existingRun.status === "pending") && 
        existingRun.startedAt.getTime() < Date.now() - AGENT_LOOP_RUN_TIMEOUT_MS;

      const isHalted = existingRun.status === "halted";

      if (!isStalled && !isHalted) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only stalled runs (running/pending for too long) or halted runs can be restarted. Current run status: ${existingRun.status}`,
        });
      }

      // For halted runs, we need to check and deduct quota before restarting
      // For stalled runs, quota was already deducted when they were created
      if (isHalted) {
        await deductRunFromQuota(userId, input.loopId, input.runId, {
          haltOnExhaustion: false, // Throw error instead of halting (since we're restarting)
          allowMissingQuota: false,
        });
      }

      // Get model config and credential
      const { providerRecord, modelRecord } = await getModelConfig(loop);
      const credential = await getCredentialForRun(
        userId,
        input.loopId,
        input.runId,
        loop,
        providerRecord,
        modelRecord,
      );

      const service = getAgentLoopService();
      const result = await service.startRunAsync({
        loopId: input.loopId,
        runId: input.runId,
        provider: providerRecord.name,
        modelId: modelRecord.modelId,
        credential,
        prompt: loop.prompt || undefined,
      });

      if (!result.success) {
        // If restart failed and this was a halted run, refund the quota
        if (isHalted) {
          try {
            await refundRunToQuota(userId, input.loopId, input.runId);
          } catch (error) {
            // Log but don't fail - the run restart already failed
            console.error("Failed to refund quota after restart failure", error);
          }
        }
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error || "Failed to restart run",
        });
      }

      const [updatedRun] = await db
        .update(agentLoopRun)
        .set({
          status: "running",
          startedAt: new Date(),
        })
        .where(eq(agentLoopRun.id, input.runId))
        .returning();

      return {
        success: true,
        run: updatedRun,
      };
    }),

  /**
   * Get loop statistics
   */
  getLoopStats: protectedProcedure
    .input(z.object({ loopId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const [loop] = await db
        .select()
        .from(agentLoop)
        .where(and(eq(agentLoop.id, input.loopId), eq(agentLoop.userId, userId)));

      if (!loop) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Loop not found",
        });
      }

      const service = getAgentLoopService();
      const stats = await service.getLoopStats(input.loopId);

      return {
        success: true,
        stats,
      };
    }),

  /**
   * Cancel a running/pending run
   */
  cancelRun: protectedProcedure
    .input(z.object({ runId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      // Get the run with its loop
      const run = await db.query.agentLoopRun.findFirst({
        where: eq(agentLoopRun.id, input.runId),
        with: {
          loop: true,
        },
      });

      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Run not found",
        });
      }

      // Verify ownership
      if (run.loop.userId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not authorized to cancel this run",
        });
      }

      if (run.status !== "running" && run.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only running or pending runs can be cancelled",
        });
      }

      // TODO: Actually stop the Cloudflare sandbox here

      const [updatedRun] = await db
        .update(agentLoopRun)
        .set({
          status: "cancelled",
          completedAt: new Date(),
        })
        .where(eq(agentLoopRun.id, input.runId))
        .returning();

      return {
        success: true,
        run: updatedRun,
      };
    }),

  /**
   * Get a specific run
   */
  getRun: protectedProcedure.input(z.object({ runId: z.uuid() })).query(async ({ input, ctx }) => {
    const userId = ctx.session.user.id;

    const run = await db.query.agentLoopRun.findFirst({
      where: eq(agentLoopRun.id, input.runId),
      with: {
        loop: true,
      },
    });

    if (!run) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Run not found",
      });
    }

    // Verify ownership
    if (run.loop.userId !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Not authorized to view this run",
      });
    }

    return {
      success: true,
      run,
    };
  }),

  /**
   * List runs for a loop
   */
  listRuns: protectedProcedure
    .input(
      z.object({
        loopId: z.uuid(),
        status: z
          .enum(["all", "pending", "running", "completed", "failed", "cancelled"])
          .default("all"),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      // Verify loop ownership
      const [loop] = await db
        .select()
        .from(agentLoop)
        .where(and(eq(agentLoop.id, input.loopId), eq(agentLoop.userId, userId)));

      if (!loop) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Loop not found",
        });
      }

      const runs = await db.query.agentLoopRun.findMany({
        where:
          input.status === "all"
            ? eq(agentLoopRun.loopId, input.loopId)
            : and(
                eq(agentLoopRun.loopId, input.loopId),
                eq(agentLoopRun.status, input.status as AgentLoopRunStatus),
              ),
        orderBy: [asc(agentLoopRun.runNumber)],
        limit: input.limit,
        offset: input.offset,
      });

      return {
        success: true,
        runs,
        pagination: {
          total: loop.totalRuns,
          limit: input.limit,
          offset: input.offset,
          hasMore: input.offset + runs.length < loop.totalRuns,
        },
      };
    }),

    getUsage: protectedProcedure.query(async ({ ctx }) => {
      const userId = ctx.session.user.id;

      const usage = await db.query.userLoopRunQuota.findFirst({
        where: eq(userLoopRunQuota.userId, userId),
      });

      if (!usage) {
        return {
          success: true,
          usage: {
            extraRuns: 0,
            monthlyRuns: MONTHLY_RUN_QUOTAS[ctx.session.user.plan ?? "free"],
          },
        };
      }

      return {
        success: true,
        usage,
      };
    }),


});
