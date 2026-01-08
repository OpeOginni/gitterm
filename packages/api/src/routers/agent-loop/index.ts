import z from "zod";
import { protectedProcedure, router } from "../../index";
import { db, eq, and, desc } from "@gitterm/db";
import { agentLoop, agentLoopRun, type AgentLoopStatus, type AgentLoopRunStatus } from "@gitterm/db/schema/agent-loop";
import { gitIntegration } from "@gitterm/db/schema/integrations";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { TRPCError } from "@trpc/server";
import { getAgentLoopService } from "../../service/agent-loop";

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
	modelProvider: z.string(), // e.g., "anthropic"
	model: z.string(), // e.g., "anthropic/claude-sonnet-4-20250514"
	prompt: z.string().optional(),
});

export const agentLoopRouter = router({
	/**
	 * Create a new agent loop
	 */
	createLoop: protectedProcedure
		.input(agentLoopCreateSchema)
		.mutation(async ({ input, ctx }) => {
		const userId = ctx.session.user.id;

		// Verify git integration belongs to user
			const [integration] = await db
				.select()
				.from(gitIntegration)
				.where(
					and(
						eq(gitIntegration.id, input.gitIntegrationId),
						eq(gitIntegration.userId, userId)
					)
				);

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
					modelProvider: input.modelProvider,
					model: input.model,
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
			z.object({
				status: z.enum(["all", "active", "paused", "completed", "archived"]).default("all"),
				limit: z.number().min(1).max(100).default(20),
				offset: z.number().min(0).default(0),
			}).optional()
		)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const { status = "all", limit = 20, offset = 0 } = input ?? {};

			const loops = await db.query.agentLoop.findMany({
				where: status === "all"
					? eq(agentLoop.userId, userId)
					: and(
						eq(agentLoop.userId, userId),
						eq(agentLoop.status, status as AgentLoopStatus)
					),
				with: {
					gitIntegration: true,
					sandboxProvider: true,
				},
				orderBy: [desc(agentLoop.createdAt)],
				limit,
				offset,
			});

			// Get total count
			const allLoops = await db
				.select({ id: agentLoop.id })
				.from(agentLoop)
				.where(
					status === "all"
						? eq(agentLoop.userId, userId)
						: and(
							eq(agentLoop.userId, userId),
							eq(agentLoop.status, status as AgentLoopStatus)
						)
				);

			return {
				success: true,
				loops,
				pagination: {
					total: allLoops.length,
					limit,
					offset,
					hasMore: offset + loops.length < allLoops.length,
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
				where: and(
					eq(agentLoop.id, input.loopId),
					eq(agentLoop.userId, userId)
				),
				with: {
					gitIntegration: true,
					sandboxProvider: true,
					runs: {
						orderBy: [desc(agentLoopRun.runNumber)],
						limit: 50, // Last 50 runs
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
				modelProvider: z.string().optional(),
				model: z.string().optional(),
			})
		)
		.mutation(async ({ input, ctx }) => {
			const userId = ctx.session.user.id;

			// Verify loop belongs to user
			const [existingLoop] = await db
				.select()
				.from(agentLoop)
				.where(
					and(
						eq(agentLoop.id, input.loopId),
						eq(agentLoop.userId, userId)
					)
				);

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
			if (input.automationEnabled !== undefined) updates.automationEnabled = input.automationEnabled;
			if (input.maxRuns !== undefined) updates.maxRuns = input.maxRuns;
			if (input.modelProvider !== undefined) updates.modelProvider = input.modelProvider;
			if (input.model !== undefined) updates.model = input.model;

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
				.where(
					and(
						eq(agentLoop.id, input.loopId),
						eq(agentLoop.userId, userId)
					)
				);

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
				.where(
					and(
						eq(agentLoop.id, input.loopId),
						eq(agentLoop.userId, userId)
					)
				);

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
				.where(
					and(
						eq(agentLoop.id, input.loopId),
						eq(agentLoop.userId, userId)
					)
				);

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
				.where(
					and(
						eq(agentLoopRun.loopId, input.loopId),
						eq(agentLoopRun.status, "pending")
					)
				);

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
	 * Mark a loop as completed
	 */
	completeLoop: protectedProcedure
		.input(z.object({ loopId: z.uuid() }))
		.mutation(async ({ input, ctx }) => {
			const userId = ctx.session.user.id;

			const [existingLoop] = await db
				.select()
				.from(agentLoop)
				.where(
					and(
						eq(agentLoop.id, input.loopId),
						eq(agentLoop.userId, userId)
					)
				);

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
	 */
	startRun: protectedProcedure
		.input(z.object({ loopId: z.uuid() }))
		.mutation(async ({ input, ctx }) => {
			const userId = ctx.session.user.id;

			// Get the loop
			const [loop] = await db
				.select()
				.from(agentLoop)
				.where(
					and(
						eq(agentLoop.id, input.loopId),
						eq(agentLoop.userId, userId)
					)
				);

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

			// Check if there's already a running/pending run
			const [existingRun] = await db
				.select()
				.from(agentLoopRun)
				.where(
					and(
						eq(agentLoopRun.loopId, input.loopId),
						eq(agentLoopRun.status, "running")
					)
				);

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

			// Create new run
			const runNumber = loop.totalRuns + 1;
			const [newRun] = await db
				.insert(agentLoopRun)
				.values({
					loopId: input.loopId,
					runNumber,
					status: "pending",
					triggerType: "manual",
					modelProvider: loop.modelProvider,
					model: loop.model,
				})
				.returning();

			if (!newRun) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create new run",
				});
			}

			await db.update(agentLoop).set({
				totalRuns: loop.totalRuns + 1,
				lastRunId: newRun.id,
			}).where(eq(agentLoop.id, input.loopId));

			return {
				success: true,
				run: newRun,
				message: `Run #${runNumber} created. Call executeRun to start execution.`,
			};
		}),

	/**
	 * Execute a pending run with AI provider configuration
	 * This starts the agent run in the Cloudflare sandbox asynchronously
	 * The run completion will be handled via callback
	 */
	executeRun: protectedProcedure
		.input(
			z.object({
				runId: z.uuid(),
				provider: z.string().min(1), // e.g., "anthropic"
				model: z.string().min(1), // e.g., "anthropic/claude-sonnet-4-20250514"
				apiKey: z.string().optional(),
				prompt: z.string().optional(), // Custom prompt (uses default if not provided)
			})
		)
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
					message: "Not authorized to execute this run",
				});
			}

			if (run.status !== "pending") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Run is in ${run.status} state, not pending`,
				});
			}

			// Start the run asynchronously
			const service = getAgentLoopService();
			const result = await service.startRunAsync({
				loopId: run.loopId,
				runId: input.runId,
				provider: input.provider,
				model: input.model,
				apiKey: input.apiKey || "",
				prompt: input.prompt,
			});

			if (!result.success) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: result.error || "Failed to start run",
				});
			}

			return {
				success: true,
				runId: result.runId,
				sandboxId: result.sandboxId,
				message: "Run started. You will receive updates when it completes.",
				async: result.async,
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
				.where(
					and(
						eq(agentLoop.id, input.loopId),
						eq(agentLoop.userId, userId)
					)
				);

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
	getRun: protectedProcedure
		.input(z.object({ runId: z.uuid() }))
		.query(async ({ input, ctx }) => {
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
				status: z.enum(["all", "pending", "running", "completed", "failed", "cancelled"]).default("all"),
				limit: z.number().min(1).max(100).default(20),
				offset: z.number().min(0).default(0),
			})
		)
		.query(async ({ input, ctx }) => {
			const userId = ctx.session.user.id;

			// Verify loop ownership
			const [loop] = await db
				.select()
				.from(agentLoop)
				.where(
					and(
						eq(agentLoop.id, input.loopId),
						eq(agentLoop.userId, userId)
					)
				);

			if (!loop) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Loop not found",
				});
			}

			const runs = await db.query.agentLoopRun.findMany({
				where: input.status === "all"
					? eq(agentLoopRun.loopId, input.loopId)
					: and(
						eq(agentLoopRun.loopId, input.loopId),
						eq(agentLoopRun.status, input.status as AgentLoopRunStatus)
					),
				orderBy: [desc(agentLoopRun.runNumber)],
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
});
