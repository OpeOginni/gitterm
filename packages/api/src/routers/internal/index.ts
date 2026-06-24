import z from "zod";
import { internalProcedure, router } from "../../index";
import { db, eq, and, sql, gt, lt, or } from "@gitterm/db";
import {
  workspace,
  dailyUsage,
  type SessionStopSource,
  volume,
} from "@gitterm/db/schema/workspace";
import { workspaceGitConfig, githubAppInstallation } from "@gitterm/db/schema/integrations";
import { agentLoop, agentLoopRun } from "@gitterm/db/schema/agent-loop";
import { cloudProvider, region } from "@gitterm/db/schema/cloud";
import { user } from "@gitterm/db/schema/auth";
import { TRPCError } from "@trpc/server";
import { getProviderByCloudProviderId } from "../../providers";
import { WORKSPACE_EVENTS } from "../../events/workspace";
import {
  closeUsageSession,
  getConfiguredIdleTimeout,
} from "../../utils/metering";
import {
  getIdleTimeoutMinutesForPlan,
  getRetentionDaysForPlan,
  getDailyMinuteQuotaAsync,
  PLAN_LIMITS,
  type UserPlan,
} from "../../config/features";
import { auth } from "@gitterm/auth";
import { getGitHubAppService, GitHubInstallationNotFoundError } from "../../service/github";
import { logger } from "../../utils/logger";
import { railwayWebhookSchema } from "../railway/webhook";
import { agentLoopWebhookSchema } from "../agent-loop/webhook";
import { getAgentLoopService } from "../../service/agent-loop";
import { deductRunFromQuota, refundRunToQuota } from "../../service/quotas/run-quota";
import { getModelConfig, getCredentialForRun } from "../../service/agent-loop/helpers";
import { e2bWebhookSchema, verifyE2BWebhookSignature } from "../e2b/webhook";
import {
  daytonaWebhookSchema,
  verifyDaytonaWebhookSignature,
} from "../daytona/webhook";
import type { DaytonaConfig } from "../../providers/daytona/types";
import { getProviderConfigService } from "../../service/config/provider-config";
import { deleteAllWorkspaceRouteAccess } from "../../service/workspace-route-access";
import {
  updateWorkspaceByIdAndInvalidate,
  updateWorkspaceStatusAndInvalidate,
} from "../../service/workspace-mutations";
import {
  filterIdleWorkspacesByRedisActivityWith,
  recordWorkspaceActivity,
} from "../../service/workspace-activity";
import type { E2BConfig } from "../../providers/e2b";
import { runAwsCleanupSweep } from "../../providers/aws/reconcile";

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
      await recordWorkspaceActivity(input.workspaceId, now);

      return { success: true, updatedAt: now };
    }),

  // Get idle workspaces (for worker)
  getIdleWorkspaces: internalProcedure.query(async () => {
    const globalIdleTimeoutMinutes = await getConfiguredIdleTimeout();
    const now = Date.now();

    // Pre-filter with the TIGHTEST timeout across all plans so aggressively
    // reaped plans (e.g. free = 10m) are never missed; the precise per-plan
    // threshold is applied in memory below.
    const planTimeouts = (Object.keys(PLAN_LIMITS) as UserPlan[])
      .map((plan) => getIdleTimeoutMinutesForPlan(plan))
      .filter((value): value is number => value !== null);
    const minCandidateMinutes = Math.min(globalIdleTimeoutMinutes, ...planTimeouts);
    const candidateThreshold = new Date(now - minCandidateMinutes * 60 * 1000);

    const idleCandidates = await db
      .select({
        id: workspace.id,
        externalInstanceId: workspace.externalInstanceId,
        userId: workspace.userId,
        regionId: workspace.regionId,
        cloudProviderId: workspace.cloudProviderId,
        domain: workspace.domain,
        lastActiveAt: workspace.lastActiveAt,
        plan: user.plan,
      })
      .from(workspace)
      .leftJoin(user, eq(workspace.userId, user.id))
      .where(and(eq(workspace.status, "running"), lt(workspace.lastActiveAt, candidateThreshold)));

    // Resolve the precise idle threshold per workspace based on its owner's
    // plan. Self-hosted returns null -> fall back to the global value.
    const thresholdFor = (ws: { plan: string | null }): Date => {
      const planTimeout = getIdleTimeoutMinutesForPlan((ws.plan ?? "free") as UserPlan);
      const timeoutMinutes = planTimeout ?? globalIdleTimeoutMinutes;
      return new Date(now - timeoutMinutes * 60 * 1000);
    };

    const idleWorkspaces = await filterIdleWorkspacesByRedisActivityWith(idleCandidates, thresholdFor);

    return idleWorkspaces.map(
      ({ lastActiveAt: _lastActiveAt, plan: _plan, ...idleWorkspace }) => idleWorkspace,
    );
  }),

  getQuotaExceededWorkspaces: internalProcedure.query(async () => {
    const today = new Date().toISOString().split("T")[0]!;

    // Get all running cloud workspaces with their users' daily usage + plan.
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
        plan: user.plan,
      })
      .from(workspace)
      .leftJoin(user, eq(workspace.userId, user.id))
      .leftJoin(
        dailyUsage,
        and(eq(workspace.userId, dailyUsage.userId), eq(dailyUsage.date, today)),
      )
      .where(and(eq(workspace.status, "running")));

    // Resolve each plan's daily minute quota once (free reads DB config). A
    // non-finite quota (self-hosted) means "never exceeded".
    const planQuotaCache = new Map<UserPlan, number>();
    const quotaForPlan = async (plan: UserPlan): Promise<number> => {
      const cached = planQuotaCache.get(plan);
      if (cached !== undefined) return cached;
      const quota = await getDailyMinuteQuotaAsync(plan);
      planQuotaCache.set(plan, quota);
      return quota;
    };

    // Filter workspaces where the user has exceeded their plan's daily quota.
    // If no usage record exists (null), they haven't exceeded (0 minutes used).
    const exceededChecks = await Promise.all(
      workspacesWithUsage.map(async (ws) => {
        const quota = await quotaForPlan((ws.plan ?? "free") as UserPlan);
        if (!Number.isFinite(quota)) return null;
        return (ws.minutesUsed ?? 0) >= quota ? ws : null;
      }),
    );
    const quotaExceededWorkspaces = exceededChecks.filter(
      (ws): ws is (typeof workspacesWithUsage)[number] => ws !== null,
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

  // Stop a workspace (for worker)
  stopWorkspaceInternal: internalProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        stopSource: z.enum(["manual", "idle", "quota_exhausted", "error"]),
      }),
    )
    .mutation(async ({ input }) => {
      // Select only required fields to avoid schema drift issues during rolling deploys
      const [ws] = await db
        .select({
          id: workspace.id,
          externalInstanceId: workspace.externalInstanceId,
          externalRunningDeploymentId: workspace.externalRunningDeploymentId,
          userId: workspace.userId,
          cloudProviderId: workspace.cloudProviderId,
          regionId: workspace.regionId,
          domain: workspace.domain,
        })
        .from(workspace)
        .where(eq(workspace.id, input.workspaceId));

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

      let workspaceRegion;

      if (provider.supportsRegions && ws.regionId) {
        [workspaceRegion] = await db.select().from(region).where(eq(region.id, ws.regionId));

        if (!workspaceRegion) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Region not found",
          });
        }
      }

      // Stop via provider
      const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
      await computeProvider.stopWorkspace(
        ws.externalInstanceId,
        workspaceRegion?.externalRegionIdentifier,
        ws.externalRunningDeploymentId || undefined,
      );

      // Close usage session
      const { durationMinutes } = await closeUsageSession(
        input.workspaceId,
        input.stopSource as SessionStopSource,
      );

      // Update workspace status
      const now = new Date();
      await updateWorkspaceByIdAndInvalidate(input.workspaceId, {
        status: "stopped",
        stoppedAt: now,
        updatedAt: now,
      });

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

  terminateWorkspaceInternal: internalProcedure
    .input(
      z.object({
        workspaceId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const [ws] = await db
        .select({
          id: workspace.id,
          externalInstanceId: workspace.externalInstanceId,
          exposedPorts: workspace.exposedPorts,
          userId: workspace.userId,
          cloudProviderId: workspace.cloudProviderId,
          regionId: workspace.regionId,
          persistent: workspace.persistent,
          domain: workspace.domain,
        })
        .from(workspace)
        .where(eq(workspace.id, input.workspaceId));

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
      if (provider.supportsRegions && ws.regionId) {
        const [workspaceRegion] = await db.select().from(region).where(eq(region.id, ws.regionId));

        if (!workspaceRegion) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Region not found",
          });
        }
      }

      const [persistedVolume] = ws.persistent
        ? await db
            .select()
            .from(volume)
            .where(and(eq(volume.workspaceId, ws.id), eq(volume.userId, ws.userId)))
        : [];

      const computeProvider = await getProviderByCloudProviderId(provider.providerKey);

      for (const exposedPort of Object.values(ws.exposedPorts ?? {})) {
        if (exposedPort?.externalPortDomainId) {
          await computeProvider.removeExposedPortDomain(exposedPort.externalPortDomainId);
        }
      }

      await computeProvider.terminateWorkspace(
        ws.externalInstanceId,
        persistedVolume?.externalVolumeId,
      );

      // Update workspace status
      const now = new Date();
      await updateWorkspaceByIdAndInvalidate(input.workspaceId, {
        status: "terminated",
        terminatedAt: now,
        updatedAt: now,
      });

      await deleteAllWorkspaceRouteAccess(input.workspaceId);

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

  sweepAwsResourcesInternal: internalProcedure.mutation(async () => {
    const sweepResult = await runAwsCleanupSweep();
    return {
      success: true,
      ...sweepResult,
    };
  }),
  /**
   * Find anonymous "try gitterm" workspaces that have outlived their 10-min
   * E2B lease (with a 2-minute grace buffer for webhook delivery). These are
   * always still in `running` state in the DB if E2B's webhook was delayed
   * or lost. The reaper terminates them as a safety net.
   */
  getAnonStragglerWorkspaces: internalProcedure.query(async () => {
    // 12 minutes ago: 10-min lease + 2-min grace
    const cutoff = new Date(Date.now() - 12 * 60 * 1000);
    const stragglers = await db
      .select({
        id: workspace.id,
        externalInstanceId: workspace.externalInstanceId,
        userId: workspace.userId,
        cloudProviderId: workspace.cloudProviderId,
        startedAt: workspace.startedAt,
      })
      .from(workspace)
      .innerJoin(user, eq(workspace.userId, user.id))
      .where(
        and(
          eq(workspace.status, "running"),
          eq(workspace.persistent, false),
          lt(workspace.startedAt, cutoff),
          // Synthetic anon users live on this domain - see service/anon/anon-user.ts
          sql`${user.email} LIKE ${"%@anon.gitterm.local"}`,
        ),
      );

    return stragglers;
  }),

  getLongTermInactiveWorkspaces: internalProcedure.query(async () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Pre-filter with the LONGEST retention across all plans so we never miss a
    // workspace; the precise per-plan threshold is applied in memory below.
    // Self-hosted returns null for every plan -> nothing is reaped.
    const planRetentions = (Object.keys(PLAN_LIMITS) as UserPlan[])
      .map((plan) => getRetentionDaysForPlan(plan))
      .filter((value): value is number => value !== null);

    if (planRetentions.length === 0) {
      // Self-hosted (or no managed plans): never terminate on inactivity.
      return [];
    }

    const maxRetentionDays = Math.max(...planRetentions);
    const candidateThreshold = new Date(now - maxRetentionDays * dayMs);

    const candidates = await db
      .select({
        id: workspace.id,
        externalInstanceId: workspace.externalInstanceId,
        userId: workspace.userId,
        regionId: workspace.regionId,
        cloudProviderId: workspace.cloudProviderId,
        domain: workspace.domain,
        status: workspace.status,
        hostingType: workspace.hostingType,
        lastActiveAt: workspace.lastActiveAt,
        plan: user.plan,
      })
      .from(workspace)
      .leftJoin(user, eq(workspace.userId, user.id))
      .where(
        and(
          or(eq(workspace.status, "running"), eq(workspace.status, "stopped")),
          eq(workspace.hostingType, "cloud"),
          lt(workspace.lastActiveAt, candidateThreshold),
        ),
      );

    // Apply the precise per-plan retention window for each workspace. A null
    // retention (self-hosted) means the workspace is never terminated.
    const longTermInactiveWorkspaces = candidates.filter((ws) => {
      const retentionDays = getRetentionDaysForPlan((ws.plan ?? "free") as UserPlan);
      if (retentionDays === null) return false;
      const threshold = new Date(now - retentionDays * dayMs);
      return ws.lastActiveAt !== null && ws.lastActiveAt < threshold;
    });

    return longTermInactiveWorkspaces.map(
      ({ plan: _plan, ...ws }) => ws,
    );
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
          .where(eq(cloudProvider.providerKey, "railway"));

        if (!railwayProvider) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Railway provider not found in database",
          });
        }

        const updatedWorkspaces = await updateWorkspaceStatusAndInvalidate(
          and(
            eq(workspace.cloudProviderId, railwayProvider.id),
            eq(workspace.externalInstanceId, serviceId),
            eq(workspace.status, "pending"),
          ),
          {
            status: "running",
            updatedAt: new Date(input.timestamp),
            externalRunningDeploymentId: input.resource.deployment?.id,
          },
        );

        return { updated: updatedWorkspaces };
      }

      if (input.type === "Deployment.failed" && input.details?.serviceId) {
        const serviceId = input.details.serviceId;

        const [railwayProvider] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.providerKey, "railway"));

        if (!railwayProvider) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Railway provider not found in database",
          });
        }

        const updatedWorkspaces = await updateWorkspaceStatusAndInvalidate(
          and(
            eq(workspace.cloudProviderId, railwayProvider.id),
            eq(workspace.externalInstanceId, serviceId),
          ),
          {
            status: "stopped",
            updatedAt: new Date(input.timestamp),
          },
        );

        return { updated: updatedWorkspaces };
      }

      return { updated: [] };
    }),

  processE2bWebhook: internalProcedure
    .input(
      e2bWebhookSchema.extend({
        rawBody: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const signature = ctx.e2bSignature;
      const webhookRawBody = input.rawBody;

      if (!signature) {
        console.error("No signature passed in for E2B Webhook");
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "E2B e2b-signature required",
        });
      }
      const dbConfig = (await getProviderConfigService().getProviderConfigForUse(
        "e2b",
      )) as E2BConfig;

      if (!dbConfig) {
        console.error("E2B provider is not configured.");
        throw new Error("E2B provider is not configured. Please configure it in the admin panel.");
      }

      const verified = verifyE2BWebhookSignature(dbConfig.webhookSecret, webhookRawBody, signature);

      if (!verified) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "E2b e2b-signature verification failed",
        });
      }

      console.log(input.type);

      if (input.type === "sandbox.lifecycle.resumed" && input.sandbox_id) {
        const serviceId = input.sandbox_id;

        const [e2bProvider] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.providerKey, "e2b"));

        if (!e2bProvider) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "E2B provider not found in database",
          });
        }

        const updatedWorkspaces = await updateWorkspaceStatusAndInvalidate(
          and(
            eq(workspace.cloudProviderId, e2bProvider.id),
            eq(workspace.externalInstanceId, serviceId),
            or(eq(workspace.status, "stopped"), eq(workspace.status, "pending")),
          ),
          {
            status: "running",
            updatedAt: new Date(input.timestamp),
          },
        );

        return { updated: updatedWorkspaces };
      }

      if (input.type === "sandbox.lifecycle.paused" && input.sandbox_id) {
        const serviceId = input.sandbox_id;

        const [e2bProvider] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.providerKey, "e2b"));

        if (!e2bProvider) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "E2B provider not found in database",
          });
        }

        const updatedWorkspaces = await updateWorkspaceStatusAndInvalidate(
          and(
            eq(workspace.cloudProviderId, e2bProvider.id),
            eq(workspace.externalInstanceId, serviceId),
            eq(workspace.status, "running"),
          ),
          {
            status: "stopped",
            updatedAt: new Date(input.timestamp),
          },
        );

        await Promise.all(
          updatedWorkspaces.map((updatedWorkspace) =>
            deleteAllWorkspaceRouteAccess(updatedWorkspace.id),
          ),
        );
        return { updated: updatedWorkspaces };
      }

      if (input.type === "sandbox.lifecycle.killed" && input.sandbox_id) {
        const serviceId = input.sandbox_id;

        const [e2bProvider] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.providerKey, "e2b"));

        if (!e2bProvider) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "E2B provider not found in database",
          });
        }

        const updatedWorkspaces = await updateWorkspaceStatusAndInvalidate(
          and(
            eq(workspace.cloudProviderId, e2bProvider.id),
            eq(workspace.externalInstanceId, serviceId),
          ),
          {
            status: "terminated",
            updatedAt: new Date(input.timestamp),
          },
        );

        return { updated: updatedWorkspaces };
      }

      return { updated: [] };
    }),

  processDaytonaWebhook: internalProcedure
    .input(
      daytonaWebhookSchema.extend({
        rawBody: z.string(),
        webhookId: z.string(),
        webhookTimestamp: z.string(),
        webhookSignature: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const webhookId = input.webhookId;
      const webhookTimestamp = input.webhookTimestamp;
      const webhookSignature = input.webhookSignature;

      if (!webhookId || !webhookTimestamp || !webhookSignature) {
        console.error("No signature headers passed in for Daytona webhook");
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Daytona webhook signature headers required",
        });
      }

      const dbConfig = (await getProviderConfigService().getProviderConfigForUse(
        "daytona",
      )) as DaytonaConfig | undefined;

      if (!dbConfig) {
        console.error("Daytona provider is not configured.");
        throw new Error(
          "Daytona provider is not configured. Please configure it in the admin panel.",
        );
      }

      if (!dbConfig.webhookSecret) {
        console.error("Daytona webhookSecret is not configured.");
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Daytona webhook secret is not configured.",
        });
      }

      try {
        verifyDaytonaWebhookSignature(dbConfig.webhookSecret, input.rawBody, {
          webhookId,
          webhookTimestamp,
          webhookSignature,
        });
      } catch (error) {
        console.error("Daytona webhook signature verification failed", error);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Daytona webhook signature verification failed",
        });
      }

      // We only act on sandbox state transitions. `sandbox.created` is a no-op
      // because creation is settled synchronously by daytona.create().
      if (input.event !== "sandbox.state.updated" || !input.newState) {
        return { updated: [] };
      }

      const sandboxId = input.id;
      const newState = input.newState.toLowerCase();
      const eventDate = new Date(input.updatedAt ?? input.timestamp);

      const [daytonaProvider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.providerKey, "daytona"));

      if (!daytonaProvider) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Daytona provider not found in database",
        });
      }

      // started -> running
      if (newState === "started") {
        const updated = await updateWorkspaceStatusAndInvalidate(
          and(
            eq(workspace.cloudProviderId, daytonaProvider.id),
            eq(workspace.externalInstanceId, sandboxId),
            or(eq(workspace.status, "stopped"), eq(workspace.status, "pending")),
          ),
          { status: "running", updatedAt: eventDate },
        );
        return { updated };
      }

      // stopped / archived -> stopped
      if (newState === "stopped" || newState === "archived") {
        const updated = await updateWorkspaceStatusAndInvalidate(
          and(
            eq(workspace.cloudProviderId, daytonaProvider.id),
            eq(workspace.externalInstanceId, sandboxId),
            eq(workspace.status, "running"),
          ),
          { status: "stopped", updatedAt: eventDate },
        );

        await Promise.all(
          updated.map((updatedWorkspace) =>
            deleteAllWorkspaceRouteAccess(updatedWorkspace.id),
          ),
        );
        return { updated };
      }

      // destroying / destroyed -> terminated.
      // We act on `destroying` (the started/stopped -> destroying transition) so
      // termination is reflected as soon as teardown begins, then `destroyed`
      // confirms it idempotently. No status filter, so this also covers
      // destruction from a paused (stopped) sandbox.
      if (newState === "destroying" || newState === "destroyed") {
        const updated = await updateWorkspaceStatusAndInvalidate(
          and(
            eq(workspace.cloudProviderId, daytonaProvider.id),
            eq(workspace.externalInstanceId, sandboxId),
            // Don't churn already-terminated rows on the second event.
            or(
              eq(workspace.status, "running"),
              eq(workspace.status, "stopped"),
              eq(workspace.status, "pending"),
            ),
          ),
          { status: "terminated", updatedAt: eventDate },
        );

        await Promise.all(
          updated.map((updatedWorkspace) =>
            deleteAllWorkspaceRouteAccess(updatedWorkspace.id),
          ),
        );
        return { updated };
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
      const [ws] = await db
        .select({
          id: workspace.id,
          userId: workspace.userId,
          status: workspace.status,
          updatedAt: workspace.updatedAt,
          domain: workspace.domain,
        })
        .from(workspace)
        .where(eq(workspace.id, input.workspaceId));

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
      try {
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
                successfulRuns: sql`${agentLoop.successfulRuns} + 1`,
                // Use GREATEST to ensure we don't decrease totalRuns if a later run already exists
                lastRunId: input.runId,
                lastRunAt: now,
                updatedAt: now,
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
              successfulRuns: sql`${agentLoop.successfulRuns} + 1`,
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

            // Deduct run from user quota and record event
            // For automated runs, we halt on exhaustion instead of throwing
            const quotaResult = await deductRunFromQuota(loop.userId, loop.id, newRun.id, {
              haltOnExhaustion: true,
              allowMissingQuota: false,
            });

            // If quota deduction failed or run should be halted, mark it and return
            if (!quotaResult.success) {
              if (quotaResult.halted) {
                await db
                  .update(agentLoopRun)
                  .set({
                    status: "halted",
                    completedAt: new Date(),
                    errorMessage:
                      quotaResult.errorMessage || "Run halted due to quota/payment issue",
                  })
                  .where(eq(agentLoopRun.id, newRun.id));

                logger.warn("Automated run halted due to quota issue", {
                  action: "automated_run_halted",
                  userId: loop.userId,
                  loopId: loop.id,
                  runId: newRun.id,
                });

                return {
                  success: false,
                  message: quotaResult.errorMessage || "Run halted due to quota/payment issue",
                };
              }
              // If not halted but failed, throw (shouldn't happen with haltOnExhaustion=true)
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: quotaResult.errorMessage || "Failed to deduct quota",
              });
            }

            // Get model config and credential
            let providerRecord, modelRecord, credential;
            try {
              const modelConfig = await getModelConfig({
                modelProviderId: run.modelProviderId,
                modelId: run.modelId,
              });
              providerRecord = modelConfig.providerRecord;
              modelRecord = modelConfig.modelRecord;

              // Check if credential is required for automated runs
              if (!modelRecord.isFree && !loop.credentialId) {
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
                    errorMessage:
                      "No API key configured for this loop. Please update the loop settings or recreate it.",
                  })
                  .where(eq(agentLoopRun.id, newRun.id));

                return {
                  success: false,
                  message: "No credential configured for automated run",
                };
              }

              credential = await getCredentialForRun(
                loop.userId,
                loop.id,
                newRun.id,
                loop,
                providerRecord,
                modelRecord,
              );
            } catch (error) {
              logger.error("Failed to get model config or credential", {
                action: "model_config_failed",
                loopId: loop.id,
                runId: newRun.id,
                error: error instanceof Error ? error.message : "Unknown error",
              });

              return {
                success: false,
                message:
                  error instanceof TRPCError ? error.message : "Failed to get model configuration",
              };
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
              // Refund quota since run failed to start
              try {
                await refundRunToQuota(loop.userId, loop.id, newRun.id);
              } catch (error) {
                logger.error("Failed to refund quota after automated run start failure", {
                  action: "automated_run_refund_failed",
                  userId: loop.userId,
                  loopId: loop.id,
                  runId: newRun.id,
                  error: error instanceof Error ? error.message : "Unknown error",
                });
              }

              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: startResult.error || "Failed to start run",
              });
            }

            // Update loop run count after successful start
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
