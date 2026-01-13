import z from "zod";
import { internalProcedure, router } from "../../index";
import { db, eq, and, sql, gt, or } from "@gitterm/db";
import {
  workspace,
  usageSession,
  dailyUsage,
  type SessionStopSource,
} from "@gitterm/db/schema/workspace";
import { workspaceGitConfig, githubAppInstallation } from "@gitterm/db/schema/integrations";
import { agentLoop, agentLoopRun } from "@gitterm/db/schema/agent-loop";
import { modelProvider, model } from "@gitterm/db/schema/model-credentials";
import { cloudProvider, region } from "@gitterm/db/schema/cloud";
import { TRPCError } from "@trpc/server";
import { getProviderByCloudProviderId } from "../../providers";
import { WORKSPACE_EVENTS } from "../../events/workspace";
import {
  closeUsageSession,
  getConfiguredIdleTimeout,
  getConfiguredFreeTierMinutes,
} from "../../utils/metering";
import { auth } from "@gitterm/auth";
import { getGitHubAppService, GitHubInstallationNotFoundError } from "../../service/github";
import { logger } from "../../utils/logger";
import { railwayWebhookSchema } from "../railway/webhook";
import { agentLoopWebhookSchema } from "../agent-loop/webhook";
import { getAgentLoopService } from "../../service/agent-loop";
import { getModelCredentialsService } from "../../service/model-credentials";

/**
 * Internal router for service-to-service communication
 * All procedures require X-Internal-Key header with valid INTERNAL_API_KEY
 */
export const internalRouter = router({
  // Validate session from cookie (for proxy)
  validateSession: internalProcedure
    .input(
      z.object({
        cookie: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const headers = new Headers();
      if (input.cookie) {
        headers.set("cookie", input.cookie);
      }

      const session = await auth.api.getSession({ headers });

      return {
        userId: session?.user?.id ?? null,
        valid: !!session?.user?.id,
      };
    }),

  // Get workspace by subdomain (for proxy)
  getWorkspaceBySubdomain: internalProcedure
    .input(z.object({ subdomain: z.string() }))
    .query(async ({ input }) => {
      const [ws] = await db
        .select()
        .from(workspace)
        .where(eq(workspace.subdomain, input.subdomain))
        .limit(1);

      if (!ws) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      return ws;
    }),

  // Update workspace heartbeat (for proxy)
  updateHeartbeat: internalProcedure
    .input(z.object({ workspaceId: z.string() }))
    .mutation(async ({ input }) => {
      const now = new Date();
      await db
        .update(workspace)
        .set({
          lastActiveAt: now,
          updatedAt: now,
        })
        .where(eq(workspace.id, input.workspaceId));

      return { success: true, updatedAt: now };
    }),

  // Get idle workspaces (for worker)
  getIdleWorkspaces: internalProcedure.query(async () => {
    const idleTimeoutMinutes = await getConfiguredIdleTimeout();
    const idleThreshold = new Date(Date.now() - idleTimeoutMinutes * 60 * 1000);

    const idleWorkspaces = await db
      .select({
        id: workspace.id,
        externalInstanceId: workspace.externalInstanceId,
        userId: workspace.userId,
        regionId: workspace.regionId,
        cloudProviderId: workspace.cloudProviderId,
        domain: workspace.domain,
      })
      .from(workspace)
      .where(
        and(
          eq(workspace.status, "running"),
          eq(workspace.hostingType, "cloud"), // Only check cloud workspaces for idle timeout
          sql`${workspace.lastActiveAt} < ${idleThreshold}`,
        ),
      );

    return idleWorkspaces;
  }),

  // ============================================================================
  // TRIAL/FREE TIER ENFORCEMENT - Comment out this procedure for paid plans
  // ============================================================================
  /**
   * Get workspaces that belong to users who have exceeded their daily quota
   * Used by idle-reaper worker to enforce free tier limits
   *
   * NOTE: Comment out this entire procedure when moving to paid plans
   */
  getQuotaExceededWorkspaces: internalProcedure.query(async () => {
    const today = new Date().toISOString().split("T")[0]!;

    // Get all running cloud workspaces with their users' daily usage
    // Local workspaces don't count towards quota since they don't use our resources
    const workspacesWithUsage = await db
      .select({
        id: workspace.id,
        externalInstanceId: workspace.externalInstanceId,
        userId: workspace.userId,
        regionId: workspace.regionId,
        cloudProviderId: workspace.cloudProviderId,
        domain: workspace.domain,
        minutesUsed: dailyUsage.minutesUsed,
      })
      .from(workspace)
      .leftJoin(
        dailyUsage,
        and(eq(workspace.userId, dailyUsage.userId), eq(dailyUsage.date, today)),
      )
      .where(
        and(
          eq(workspace.status, "running"),
          eq(workspace.hostingType, "cloud"), // Only check cloud workspaces
        ),
      );

    // Filter workspaces where user has exceeded quota
    // If no usage record exists (null), they haven't exceeded (0 minutes used)
    const freeTierDailyMinutes = await getConfiguredFreeTierMinutes();
    const quotaExceededWorkspaces = workspacesWithUsage.filter(
      (ws) => (ws.minutesUsed ?? 0) >= freeTierDailyMinutes,
    );

    logger.info(`Found ${quotaExceededWorkspaces.length} workspaces with exceeded quota`, {
      action: "quota_check",
    });

    return quotaExceededWorkspaces.map((ws) => ({
      id: ws.id,
      externalInstanceId: ws.externalInstanceId,
      userId: ws.userId,
      regionId: ws.regionId,
      cloudProviderId: ws.cloudProviderId,
      domain: ws.domain,
    }));
  }),
  // END OF TRIAL ENFORCEMENT PROCEDURE
  // ============================================================================

  // Stop a workspace (for worker)
  stopWorkspaceInternal: internalProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        stopSource: z.enum(["manual", "idle", "quota_exhausted", "error"]),
      }),
    )
    .mutation(async ({ input }) => {
      // Get workspace with related data
      const [ws] = await db.select().from(workspace).where(eq(workspace.id, input.workspaceId));

      if (!ws) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      // Get cloud provider
      const [provider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, ws.cloudProviderId));

      if (!provider) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Cloud provider not found",
        });
      }

      // Get region
      const [workspaceRegion] = await db.select().from(region).where(eq(region.id, ws.regionId));

      if (!workspaceRegion) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Region not found",
        });
      }

      // Stop via provider
      const computeProvider = await getProviderByCloudProviderId(provider.name);
      await computeProvider.stopWorkspace(
        ws.externalInstanceId,
        workspaceRegion.externalRegionIdentifier,
        ws.externalRunningDeploymentId || undefined,
      );

      // Close usage session
      const { durationMinutes } = await closeUsageSession(
        input.workspaceId,
        input.stopSource as SessionStopSource,
      );

      // Update workspace status
      const now = new Date();
      await db
        .update(workspace)
        .set({
          status: "stopped",
          stoppedAt: now,
          updatedAt: now,
        })
        .where(eq(workspace.id, input.workspaceId));

      // Emit status event
      WORKSPACE_EVENTS.emitStatus({
        workspaceId: input.workspaceId,
        status: "stopped",
        updatedAt: now,
        userId: ws.userId,
        workspaceDomain: ws.domain,
      });

      return { success: true, durationMinutes };
    }),

  // Terminate a workspace (for tunnel-proxy on disconnect)
  terminateWorkspaceInternal: internalProcedure
    .input(z.object({ workspaceId: z.string() }))
    .mutation(async ({ input }) => {
      // Get workspace with related data
      const [ws] = await db.select().from(workspace).where(eq(workspace.id, input.workspaceId));

      if (!ws) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      // Close usage session if workspace was running (only for cloud workspaces)
      if (ws.hostingType !== "local" && (ws.status === "running" || ws.status === "pending")) {
        await closeUsageSession(input.workspaceId, "manual");
      }

      // Get cloud provider
      const [provider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, ws.cloudProviderId));

      if (!provider) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Cloud provider not found",
        });
      }

      // Get compute provider and terminate the workspace
      // For local workspaces, this is a no-op
      const computeProvider = await getProviderByCloudProviderId(provider.name);
      await computeProvider.terminateWorkspace(ws.externalInstanceId);

      // Update workspace status
      const now = new Date();
      await db
        .update(workspace)
        .set({
          status: "terminated",
          stoppedAt: now,
          terminatedAt: now,
          updatedAt: now,
        })
        .where(eq(workspace.id, input.workspaceId));

      // Emit status event
      WORKSPACE_EVENTS.emitStatus({
        workspaceId: input.workspaceId,
        status: "terminated",
        updatedAt: now,
        userId: ws.userId,
        workspaceDomain: ws.domain,
      });

      return { success: true };
    }),
  getLongTermInactiveWorkspaces: internalProcedure.query(async () => {
    const longTermInactiveWorkspaces = await db
      .select()
      .from(workspace)
      .where(
        and(
          or(eq(workspace.status, "running"), eq(workspace.status, "stopped")),
          eq(workspace.hostingType, "cloud"),
          sql`${workspace.lastActiveAt} < ${new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)}`, // 4 days ago
        ),
      );

    return longTermInactiveWorkspaces;
  }),
  // Get daily stats (for worker/analytics)
  getDailyStats: internalProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const stats = await db
        .select({
          totalUsers: sql<number>`count(distinct ${dailyUsage.userId})`,
          totalMinutes: sql<number>`coalesce(sum(${dailyUsage.minutesUsed}), 0)`,
        })
        .from(dailyUsage)
        .where(sql`${dailyUsage.date} = ${input.date}`);

      const sessionStats = await db
        .select({
          totalSessions: sql<number>`count(*)`,
          avgDuration: sql<number>`coalesce(avg(${usageSession.durationMinutes}), 0)`,
          manualStops: sql<number>`count(*) filter (where ${usageSession.stopSource} = 'manual')`,
          idleStops: sql<number>`count(*) filter (where ${usageSession.stopSource} = 'idle')`,
          quotaStops: sql<number>`count(*) filter (where ${usageSession.stopSource} = 'quota_exhausted')`,
        })
        .from(usageSession)
        .where(sql`date(${usageSession.createdAt}) = ${input.date}`);

      return {
        date: input.date,
        users: {
          total: stats[0]?.totalUsers ?? 0,
          totalMinutes: stats[0]?.totalMinutes ?? 0,
        },
        sessions: {
          total: sessionStats[0]?.totalSessions ?? 0,
          avgDuration: Math.round(Number(sessionStats[0]?.avgDuration) || 0),
          manualStops: sessionStats[0]?.manualStops ?? 0,
          idleStops: sessionStats[0]?.idleStops ?? 0,
          quotaStops: sessionStats[0]?.quotaStops ?? 0,
        },
      };
    }),

  // Fork repository (called from workspace)
  forkRepository: internalProcedure
    .input(
      z.object({
        workspaceId: z.uuid(),
        owner: z.string(),
        repo: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        // Get workspace to verify it exists and get userId
        const [workspaceRecord] = await db
          .select()
          .from(workspace)
          .where(eq(workspace.id, input.workspaceId));

        if (!workspaceRecord) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workspace not found",
          });
        }

        // Security: Verify workspace is in running state
        // This prevents calls from stopped/terminated workspaces
        if (workspaceRecord.status !== "running" && workspaceRecord.status !== "pending") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Workspace is not active. Cannot perform fork operation.",
          });
        }

        const userId = workspaceRecord.userId;

        if (!workspaceRecord.gitIntegrationId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "GitHub App not connected. Please connect your GitHub account.",
          });
        }

        const githubService = getGitHubAppService();
        // Get GitHub App installation with verification
        const installation = await githubService.getUserInstallation(
          userId,
          workspaceRecord.gitIntegrationId,
          true, // verify
        );

        if (!installation) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "GitHub App not connected or has been removed. Please reconnect your GitHub account.",
          });
        }

        if (installation.suspended) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "GitHub App installation is suspended.",
          });
        }

        // Security: Rate limiting - check if this user has forked recently
        // (Prevents abuse of the fork API)
        const recentForks = await db
          .select()
          .from(workspaceGitConfig)
          .where(
            and(
              eq(workspaceGitConfig.userId, userId),
              gt(workspaceGitConfig.forkCreatedAt, new Date(Date.now() - 60000)), // Last minute
            ),
          );

        if (recentForks.length >= 3) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many fork requests. Please wait a minute and try again.",
          });
        }

        // Fork the repository
        const fork = await githubService.forkRepository(
          installation.installationId,
          input.owner,
          input.repo,
        );

        // Update or create workspace git config
        const [existingConfig] = await db
          .select()
          .from(workspaceGitConfig)
          .where(eq(workspaceGitConfig.workspaceId, input.workspaceId));

        if (existingConfig) {
          // Update existing config
          await db
            .update(workspaceGitConfig)
            .set({
              repositoryUrl: fork.cloneUrl,
              repositoryOwner: fork.owner,
              repositoryName: fork.repo,
              isFork: true,
              originalOwner: input.owner,
              originalRepo: input.repo,
              forkCreatedAt: new Date(),
              defaultBranch: fork.defaultBranch,
              updatedAt: new Date(),
            })
            .where(eq(workspaceGitConfig.id, existingConfig.id));
        } else {
          // Create new config
          await db.insert(workspaceGitConfig).values({
            workspaceId: input.workspaceId,
            userId,
            provider: "github",
            repositoryUrl: fork.cloneUrl,
            repositoryOwner: fork.owner,
            repositoryName: fork.repo,
            isFork: true,
            originalOwner: input.owner,
            originalRepo: input.repo,
            forkCreatedAt: new Date(),
            defaultBranch: fork.defaultBranch,
          });
        }

        // Generate authenticated URL for the workspace to use
        const { token } = await githubService.getUserToServerToken(installation.installationId);
        const authenticatedUrl = githubService.getAuthenticatedGitUrl(token, fork.owner, fork.repo);

        logger.info("Fork operation completed", {
          workspaceId: input.workspaceId,
          userId,
          action: "fork_repository_internal",
        });

        return {
          success: true,
          message: "Repository forked successfully",
          fork: {
            owner: fork.owner,
            repo: fork.repo,
            cloneUrl: fork.cloneUrl,
            authenticatedUrl, // For immediate use in workspace
            htmlUrl: fork.htmlUrl,
            defaultBranch: fork.defaultBranch,
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        // Handle installation not found specifically
        if (error instanceof GitHubInstallationNotFoundError) {
          logger.warn("GitHub installation not found during fork", {
            workspaceId: input.workspaceId,
            action: "fork_repository_internal",
          });
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "GitHub App installation has been removed. Please reconnect.",
          });
        }

        logger.error(
          "Failed to fork repository",
          {
            workspaceId: input.workspaceId,
            action: "fork_repository_internal",
          },
          error as Error,
        );

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fork repository",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // ============================================================================
  // LISTENER ENDPOINTS
  // These endpoints are called by the listener service to avoid direct DB access
  // ============================================================================

  /**
   * Process Railway webhook
   * Called by listener when it receives a Railway deployment webhook
   */
  processRailwayWebhook: internalProcedure
    .input(railwayWebhookSchema)
    .mutation(async ({ input }) => {
      if (input.type === "Deployment.deployed" && input.details?.serviceId) {
        const serviceId = input.details.serviceId;

        const [railwayProvider] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.name, "Railway"));

        if (!railwayProvider) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Railway provider not found in database",
          });
        }

        const updatedWorkspaces = await db
          .update(workspace)
          .set({
            status: "running",
            updatedAt: new Date(input.timestamp),
            externalRunningDeploymentId: input.resource.deployment?.id,
          })
          .where(
            and(
              eq(workspace.cloudProviderId, railwayProvider.id),
              eq(workspace.externalInstanceId, serviceId),
              eq(workspace.status, "pending"),
            ),
          )
          .returning({
            id: workspace.id,
            status: workspace.status,
            updatedAt: workspace.updatedAt,
            userId: workspace.userId,
            workspaceDomain: workspace.domain,
          });

        return { updated: updatedWorkspaces };
      }

      return { updated: [] };
    }),

  /**
   * Validate workspace access for SSE subscription
   * Returns workspace info if valid, throws if not found or unauthorized
   */
  validateWorkspaceAccess: internalProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        userId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const [ws] = await db.select().from(workspace).where(eq(workspace.id, input.workspaceId));

      if (!ws) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      if (ws.userId !== input.userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to access this workspace",
        });
      }

      return {
        workspaceId: ws.id,
        status: ws.status,
        updatedAt: ws.updatedAt,
        userId: ws.userId,
        workspaceDomain: ws.domain,
      };
    }),

  /**
   * Process GitHub installation webhook
   * Called by listener when it receives a GitHub App installation webhook
   */
  processGitHubInstallationWebhook: internalProcedure
    .input(
      z.object({
        action: z.enum(["created", "deleted", "suspend", "unsuspend", "new_permissions_accepted"]),
        installationId: z.string(),
        accountLogin: z.string(),
        accountId: z.string(),
        accountType: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      logger.info("Processing GitHub installation webhook", {
        action: `github_webhook_${input.action}`,
        installationId: input.installationId,
      });

      if (input.action === "deleted") {
        // User uninstalled the GitHub App from GitHub's side
        // Clean up our database records
        const githubService = getGitHubAppService();
        const result = await githubService.removeInstallationByInstallationId(input.installationId);

        logger.info("GitHub installation deleted via webhook", {
          action: "github_webhook_deleted",
          installationId: input.installationId,
        });

        return {
          success: true,
          action: "deleted",
          deletedInstallations: result.deletedInstallations,
          deletedIntegrations: result.deletedIntegrations,
        };
      }

      if (input.action === "suspend") {
        // App was suspended - mark as suspended in our database
        const now = new Date();

        const updatedInstallations = await db
          .update(githubAppInstallation)
          .set({
            suspended: true,
            suspendedAt: now,
            updatedAt: now,
          })
          .where(eq(githubAppInstallation.installationId, input.installationId))
          .returning();

        logger.info("GitHub installation suspended", {
          action: "github_webhook_suspend",
          installationId: input.installationId,
        });

        return {
          success: true,
          action: "suspended",
          updatedCount: updatedInstallations.length,
        };
      }

      if (input.action === "unsuspend") {
        // App was unsuspended - clear the suspended flag
        const now = new Date();

        const updatedInstallations = await db
          .update(githubAppInstallation)
          .set({
            suspended: false,
            suspendedAt: null,
            updatedAt: now,
          })
          .where(eq(githubAppInstallation.installationId, input.installationId))
          .returning();

        logger.info("GitHub installation unsuspended", {
          action: "github_webhook_unsuspend",
          installationId: input.installationId,
        });

        return {
          success: true,
          action: "unsuspended",
          updatedCount: updatedInstallations.length,
        };
      }

      // For "created" and "new_permissions_accepted", we just acknowledge
      // The user flow already handles storing installation on the callback
      logger.info(`GitHub installation webhook received: ${input.action}`, {
        action: `github_webhook_${input.action}`,
        installationId: input.installationId,
      });

      return {
        success: true,
        action: input.action,
      };
    }),

  // ============================================================================
  // AGENT LOOP CALLBACK
  // Called by Cloudflare worker when a sandbox run completes or fails
  // ============================================================================

  /**
   * Process agent loop run callback from Cloudflare worker
   * Updates run status, loop counters, and triggers next run if automated
   */
  processAgentLoopCallback: internalProcedure
    .input(agentLoopWebhookSchema)
    .mutation(async ({ input }) => {

      try{

      console.log("Processing agent loop callback", {
        action: "agent_loop_callback",
        input: input,
      });

      // Get the run with its loop
      const run = await db.query.agentLoopRun.findFirst({
        where: eq(agentLoopRun.id, input.runId),
        with: {
          loop: true,
        },
      });

      if (!run) {
        logger.warn("Agent loop callback: run not found", {
          action: "agent_loop_callback_not_found",
          runId: input.runId,
        });
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Run not found",
        });
      }

      // Check if run is in a state that can be updated
      if (run.status !== "running" && run.status !== "pending") {
        logger.warn("Agent loop callback: run already completed", {
          action: "agent_loop_callback_already_done",
          runId: input.runId,
          status: run.status,
        });
        return {
          success: true,
          message: "Run already completed, callback ignored",
        };
      }

      const loop = run.loop;
      const now = new Date();
      const durationSeconds = Math.round((now.getTime() - run.startedAt.getTime()) / 1000);

      if (input.success) {
        // Update run as completed
        await db
          .update(agentLoopRun)
          .set({
            status: "completed",
            completedAt: now,
            durationSeconds,
            sandboxId: input.sandboxId,
            commitSha: input.commitSha,
            commitMessage: input.commitMessage,
          })
          .where(eq(agentLoopRun.id, input.runId));

        if (input.isListComplete) {
          await db
            .update(agentLoop)
            .set({
              status: "completed" as const,
            })
            .where(eq(agentLoop.id, loop.id));
            
          return {
            success: true,
            message: "Run completed, loop is complete",
          };
        }

        // Update loop counters

        // Check if this is the last iteration
        // Use run.runNumber instead of loop.totalRuns to handle restart scenarios correctly
        const isLastIteration = run.runNumber >= loop.maxRuns;

        await db
          .update(agentLoop)
          .set({
            successfulRuns: loop.successfulRuns + 1,
            lastRunId: input.runId,
            lastRunAt: now,
            updatedAt: now,
            // Mark loop as completed if agent says so
            ...(isLastIteration ? { status: "completed" as const } : {}),
          })
          .where(eq(agentLoop.id, loop.id));

        logger.info("Agent loop run completed successfully", {
          action: "agent_loop_run_complete",
          loopId: loop.id,
          runId: input.runId,
          runNumber: run.runNumber,
          commitSha: input.commitSha,
          durationSeconds,
        });

        // Trigger next run if automation is enabled and not complete
        if (loop.automationEnabled && !isLastIteration) {
          // Create next pending run with the same AI config as the completed run
          const nextRunNumber = run.runNumber + 1; // Next run after the completing one
          const [newRun] = await db
            .insert(agentLoopRun)
            .values({
              loopId: loop.id,
              runNumber: nextRunNumber,
              status: "pending",
              triggerType: "automated",
              modelProviderId: run.modelProviderId,
              modelId: run.modelId,
            })
            .returning();

          if (!newRun) {
            logger.error("Failed to create next automated run", {
              action: "automated_run_creation_failed",
              loopId: loop.id,
              runNumber: nextRunNumber,
            });

            return {
              success: false,
              message: "Failed to create next automated run",
            };
          }

          // Resolve model provider and model names from UUIDs for the service
          const [providerRecord] = await db
            .select()
            .from(modelProvider)
            .where(eq(modelProvider.id, run.modelProviderId));

          const [modelRecord] = await db
            .select()
            .from(model)
            .where(eq(model.id, run.modelId));

          if (!providerRecord || !modelRecord) {
            logger.error("Model provider or model not found", {
              action: "model_lookup_failed",
              loopId: loop.id,
            });

            return {
              success: false,
              message: "Model provider or model not found",
            };
          }

          // Get the credential for this automated run
          const credService = getModelCredentialsService();
          let credential: import("../../providers/compute").SandboxCredential = {
            type: "api_key",
            apiKey: "", // Default empty for free models
          };

          // Only require credential for non-free models
          if (!modelRecord.isFree) {
            if (!loop.credentialId) {
              logger.error("No credential configured for automated run", {
                action: "credential_missing",
                loopId: loop.id,
              });

              // Mark the run as failed so it doesn't stay pending forever
              await db
                .update(agentLoopRun)
                .set({
                  status: "failed",
                  completedAt: new Date(),
                  errorMessage: "No API key configured for this loop. Please update the loop settings or recreate it.",
                })
                .where(eq(agentLoopRun.id, newRun.id));

              return {
                success: false,
                message: "No credential configured for automated run",
              };
            }

            credential = await credService.getCredentialForRun(
              loop.credentialId,
              loop.userId,
              { loopId: loop.id, runId: newRun.id },
            );
          }

          const service = getAgentLoopService();
          const startResult = await service.startRunAsync({
            loopId: loop.id,
            runId: newRun.id,
            provider: providerRecord.name,
            modelId: modelRecord.modelId,
            credential,
            prompt: loop.prompt || undefined,
          });

          if (!startResult.success) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: startResult.error || "Failed to start run",
            });
          }

          await db
            .update(agentLoop)
            .set({
              totalRuns: nextRunNumber, // Use the new run number directly
              lastRunId: newRun.id,
            })
            .where(eq(agentLoop.id, loop.id));

          logger.info("Created next automated run", {
            action: "automated_run_created",
            loopId: loop.id,
            runId: newRun?.id,
            runNumber: nextRunNumber,
          });

          return {
            success: true,
            message: "Run completed, next run created",
            nextRunId: newRun?.id,
          };
        }

        return {
          success: true,
          message: "Run completed, plan is complete",
        };
      } else {
        // Update run as failed
        await db
          .update(agentLoopRun)
          .set({
            status: "failed",
            completedAt: now,
            durationSeconds,
            sandboxId: input.sandboxId,
            errorMessage: input.error,
          })
          .where(eq(agentLoopRun.id, input.runId));

        // Update loop counters
        // Note: totalRuns was already incremented when the run was created, so don't increment again
        await db
          .update(agentLoop)
          .set({
            failedRuns: loop.failedRuns + 1,
            lastRunId: input.runId,
            lastRunAt: now,
            updatedAt: now,
          })
          .where(eq(agentLoop.id, loop.id));

        logger.error("Agent loop run failed", {
          action: "agent_loop_run_failed",
          loopId: loop.id,
          runId: input.runId,
          runNumber: run.runNumber,
          error: input.error,
        });

        // TODO: Send email notification about failure

        return {
          success: true,
          message: "Run failure recorded",
        };
      } 
    } catch (error) {
        logger.error("Failed to process agent loop callback", {
          action: "agent_loop_callback_failed",
          runId: input.runId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process agent loop callback",
        });
      }
    }),
});

export type InternalRouter = typeof internalRouter;
