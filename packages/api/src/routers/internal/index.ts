import z from "zod";
import { internalProcedure, router } from "../../index";
import { db, eq, and, sql, lt, or, isNull, inArray } from "@gitterm/db";
import { workspace, type SessionStopSource, volume } from "@gitterm/db/schema/workspace";
import { githubAppInstallation } from "@gitterm/db/schema/integrations";
import { cloudProvider, region } from "@gitterm/db/schema/cloud";
import { user } from "@gitterm/db/schema/auth";
import { TRPCError } from "@trpc/server";
import { getProviderByCloudProviderId } from "../../providers";
import { WORKSPACE_EVENTS } from "../../events/workspace";
import { closeUsageSession, getConfiguredIdleTimeout } from "../../utils/metering";
import { getBilling } from "../../billing";
import { ALWAYS_ON_LEASE_MS } from "../../service/workspace-timeouts";
import { renderEmail } from "../../service/email/render";
import { sendEmail } from "../../service/email/mailer";
import { BillingNoticeEmail } from "../../service/email/templates/billing-notice";
import env from "@gitterm/env/server";
import { isPausedWorkspacePastRetention } from "../../utils/workspace-retention";
import { getGitHubAppService } from "../../service/github";
import { logger } from "../../utils/logger";
import { railwayWebhookSchema } from "../railway/webhook";
import { e2bWebhookSchema, verifyE2BWebhookSignature } from "../e2b/webhook";
import { daytonaWebhookSchema, verifyDaytonaWebhookSignature } from "../daytona/webhook";
import type { DaytonaConfig } from "../../providers/daytona/types";
import { getProviderConfigService } from "../../service/config/provider-config";
import { deleteAllWorkspaceRouteAccess } from "../../service/workspace-route-access";
import {
  updateWorkspaceByIdAndInvalidate,
  updateWorkspaceStatusAndInvalidate,
} from "../../service/workspace-mutations";
import { filterIdleWorkspacesByRedisActivityWith } from "../../service/workspace-activity";
import type { E2BConfig } from "../../providers/e2b";
import { runAwsCleanupSweep } from "../../providers/aws/reconcile";
import { ANON_WORKSPACE_TTL_SECONDS } from "../../service/anon/anon-lifetime";
import { isAnonEmail } from "../../service/anon/anon-user";
import { finalizeWorkspaceAgentRuns } from "../../service/agent-run";

/**
 * Internal router for service-to-service communication
 * All procedures require X-Internal-Key header with valid INTERNAL_API_KEY
 */
export const internalRouter = router({
  // Get idle workspaces (for worker)
  getIdleWorkspaces: internalProcedure.query(async () => {
    const globalIdleTimeoutMinutes = await getConfiguredIdleTimeout();
    const now = Date.now();

    // Running workspaces are few; each owner's idle timeout is applied below.
    const runningWorkspaces = await db
      .select({
        id: workspace.id,
        externalInstanceId: workspace.externalInstanceId,
        userId: workspace.userId,
        regionId: workspace.regionId,
        cloudProviderId: workspace.cloudProviderId,
        domain: workspace.domain,
        lastActiveAt: workspace.lastActiveAt,
        alwaysOn: workspace.alwaysOn,
        email: user.email,
      })
      .from(workspace)
      .leftJoin(user, eq(workspace.userId, user.id))
      .where(eq(workspace.status, "running"));
    const entitlements = await (
      await getBilling()
    ).getEntitlementsForUsers([...new Set(runningWorkspaces.map((ws) => ws.userId))]);
    // Always-on workspaces skip idle pausing while their owner's plan allows it.
    const candidates = runningWorkspaces.filter(
      (ws) => !isAnonEmail(ws.email) && !(ws.alwaysOn && entitlements.get(ws.userId)?.alwaysOn),
    );
    const thresholdFor = (ws: { userId: string }): Date => {
      const timeoutMinutes =
        entitlements.get(ws.userId)?.idleTimeoutMinutes ?? globalIdleTimeoutMinutes;
      return new Date(now - timeoutMinutes * 60 * 1000);
    };

    const idleWorkspaces = await filterIdleWorkspacesByRedisActivityWith(
      candidates.filter((ws) => ws.lastActiveAt && ws.lastActiveAt < thresholdFor(ws)),
      thresholdFor,
    );

    return idleWorkspaces.map(
      ({ lastActiveAt: _lastActiveAt, alwaysOn: _alwaysOn, email: _email, ...idleWorkspace }) =>
        idleWorkspace,
    );
  }),

  /** Renew provider leases of running always-on workspaces (for worker). */
  keepAlwaysOnWorkspacesAlive: internalProcedure.mutation(async () => {
    const workspaces = await db
      .select({
        id: workspace.id,
        userId: workspace.userId,
        externalInstanceId: workspace.externalInstanceId,
        cloudProviderId: workspace.cloudProviderId,
        providerKey: cloudProvider.providerKey,
      })
      .from(workspace)
      .innerJoin(cloudProvider, eq(workspace.cloudProviderId, cloudProvider.id))
      .where(
        and(
          eq(workspace.status, "running"),
          eq(workspace.hostingType, "cloud"),
          eq(workspace.alwaysOn, true),
        ),
      );
    const entitlements = await (
      await getBilling()
    ).getEntitlementsForUsers([...new Set(workspaces.map((ws) => ws.userId))]);

    let renewed = 0;
    for (const ws of workspaces) {
      if (!entitlements.get(ws.userId)?.alwaysOn) continue;
      try {
        const provider = await getProviderByCloudProviderId(ws.providerKey, ws.cloudProviderId);
        if (!provider.keepAliveWorkspace) continue;
        await provider.keepAliveWorkspace(ws.externalInstanceId, ALWAYS_ON_LEASE_MS);
        renewed++;
      } catch (error) {
        console.error(`[always-on] Failed to renew lease for workspace ${ws.id}`, error);
      }
    }
    return { renewed };
  }),

  /** Report usage to the payment provider and email usage alerts (for worker). */
  runBillingTasks: internalProcedure.mutation(async () => {
    const notices = await (await getBilling()).runPeriodicTasks();
    const billingUrl = `${env.BASE_URL ?? `https://${env.BASE_DOMAIN}`}/dashboard/settings/account#billing`;
    let sent = 0;
    for (const notice of notices) {
      const [owner] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, notice.userId));
      if (!owner || isAnonEmail(owner.email)) continue;
      try {
        await sendEmail({
          to: owner.email,
          ...(await renderEmail(notice.subject, BillingNoticeEmail({ ...notice, billingUrl }))),
        });
        sent++;
      } catch (error) {
        console.error(`[billing] Failed to send usage alert to user ${notice.userId}`, error);
      }
    }
    return { notices: notices.length, sent };
  }),

  getQuotaExceededWorkspaces: internalProcedure.query(async () => {
    const billing = await getBilling();
    if (!billing.enabled) return [];

    // Local workspaces don't use our compute, so only cloud workspaces stop.
    const runningWorkspaces = await db
      .select({
        id: workspace.id,
        externalInstanceId: workspace.externalInstanceId,
        userId: workspace.userId,
        regionId: workspace.regionId,
        cloudProviderId: workspace.cloudProviderId,
        domain: workspace.domain,
        email: user.email,
      })
      .from(workspace)
      .leftJoin(user, eq(workspace.userId, user.id))
      .where(and(eq(workspace.status, "running"), eq(workspace.hostingType, "cloud")));
    const candidates = runningWorkspaces.filter((ws) => !isAnonEmail(ws.email));
    const overAllowance = await billing.getUsersOverAllowance([
      ...new Set(candidates.map((ws) => ws.userId)),
    ]);
    const quotaExceededWorkspaces = candidates.filter((ws) => overAllowance.has(ws.userId));

    logger.info(`Found ${quotaExceededWorkspaces.length} workspaces with exceeded quota`, {
      action: "quota_check",
    });

    return quotaExceededWorkspaces.map(({ email: _email, ...ws }) => ws);
  }),

  // Pause a workspace (for worker)
  pauseWorkspaceInternal: internalProcedure
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
        .where(and(eq(workspace.id, input.workspaceId), eq(workspace.status, "running")));

      if (!ws) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace is no longer running",
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

      // Pause via provider
      const computeProvider = await getProviderByCloudProviderId(provider.providerKey, provider.id);
      await finalizeWorkspaceAgentRuns(input.workspaceId, ws.userId);
      await computeProvider.pauseWorkspace(
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
        status: "paused",
        pausedAt: now,
        updatedAt: now,
      });

      // Emit status event
      WORKSPACE_EVENTS.emitStatus({
        workspaceId: input.workspaceId,
        status: "paused",
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
        requirePaused: z.boolean().default(false).optional(),
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
        .where(
          input.requirePaused
            ? and(eq(workspace.id, input.workspaceId), eq(workspace.status, "paused"))
            : eq(workspace.id, input.workspaceId),
        );

      if (!ws) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: input.requirePaused ? "Workspace is no longer paused" : "Workspace not found",
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

      const computeProvider = await getProviderByCloudProviderId(provider.providerKey, provider.id);
      await finalizeWorkspaceAgentRuns(input.workspaceId, ws.userId);

      for (const exposedPort of Object.values(ws.exposedPorts ?? {})) {
        if (exposedPort?.externalPortDomainId) {
          await computeProvider.removeExposedPortDomain(exposedPort.externalPortDomainId);
        }
      }

      await computeProvider.terminateWorkspace(
        ws.externalInstanceId,
        persistedVolume?.externalVolumeId,
      );

      if (persistedVolume) {
        await db.delete(volume).where(eq(volume.workspaceId, input.workspaceId));
      }

      // Update workspace status
      const now = new Date();
      await updateWorkspaceByIdAndInvalidate(input.workspaceId, {
        status: "terminated",
        externalInstanceId: "",
        externalRunningDeploymentId: null,
        upstreamUrl: null,
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
   * E2B lease. These are
   * always still in `running` state in the DB if E2B's webhook was delayed
   * or lost. The reaper terminates them as a safety net.
   */
  getAnonStragglerWorkspaces: internalProcedure.query(async () => {
    const cutoff = new Date(Date.now() - ANON_WORKSPACE_TTL_SECONDS * 1_000);
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

  /** Workspaces whose caller-set autoTerminateAt has passed and are not yet terminated. */
  getAutoTerminateDueWorkspaces: internalProcedure.query(async () => {
    return db
      .select({ id: workspace.id, autoTerminateAt: workspace.autoTerminateAt })
      .from(workspace)
      .where(
        and(
          inArray(workspace.status, ["pending", "running", "paused"]),
          lt(workspace.autoTerminateAt, new Date()),
        ),
      );
  }),

  getLongTermInactiveWorkspaces: internalProcedure.query(async () => {
    const billing = await getBilling();
    // Without billing, paused workspaces are kept until their owner deletes them.
    if (!billing.enabled) return [];

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
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
        pausedAt: workspace.pausedAt,
      })
      .from(workspace)
      .where(and(eq(workspace.status, "paused"), eq(workspace.hostingType, "cloud")));

    // Apply each owner's retention window. A null retention keeps the workspace.
    const entitlements = await billing.getEntitlementsForUsers([
      ...new Set(candidates.map((ws) => ws.userId)),
    ]);
    return candidates.filter((ws) => {
      const retentionDays = entitlements.get(ws.userId)?.retentionDays ?? null;
      if (retentionDays === null) return false;
      return isPausedWorkspacePastRetention({
        status: ws.status,
        lastActiveAt: ws.lastActiveAt,
        pausedAt: ws.pausedAt,
        threshold: new Date(now - retentionDays * dayMs),
      });
    });
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
            or(
              eq(workspace.status, "pending"),
              and(eq(workspace.status, "running"), isNull(workspace.externalRunningDeploymentId)),
            ),
          ),
          {
            status: "running",
            updatedAt: new Date(input.timestamp),
            externalRunningDeploymentId: input.resource.deployment?.id ?? input.details?.id,
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
            status: "paused",
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
            or(eq(workspace.status, "paused"), eq(workspace.status, "pending")),
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
            or(
              isNull(workspace.lastActiveAt),
              lt(workspace.lastActiveAt, new Date(input.timestamp)),
            ),
          ),
          {
            status: "paused",
            updatedAt: new Date(input.timestamp),
          },
        );

        await Promise.all(
          updatedWorkspaces.map((updatedWorkspace) =>
            Promise.all([
              closeUsageSession(updatedWorkspace.id, "provider_auto"),
              deleteAllWorkspaceRouteAccess(updatedWorkspace.id),
              finalizeWorkspaceAgentRuns(updatedWorkspace.id, updatedWorkspace.userId),
            ]),
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

        await Promise.all(
          updatedWorkspaces.map((updatedWorkspace) =>
            Promise.all([
              closeUsageSession(updatedWorkspace.id, "provider_auto"),
              deleteAllWorkspaceRouteAccess(updatedWorkspace.id),
              finalizeWorkspaceAgentRuns(updatedWorkspace.id, updatedWorkspace.userId),
            ]),
          ),
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

      const dbConfig = (await getProviderConfigService().getProviderConfigForUse("daytona")) as
        | DaytonaConfig
        | undefined;

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
            or(eq(workspace.status, "paused"), eq(workspace.status, "pending")),
          ),
          { status: "running", updatedAt: eventDate },
        );
        return { updated };
      }

      // Daytona stopped/archived -> workspace paused
      if (newState === "stopped" || newState === "archived") {
        const updated = await updateWorkspaceStatusAndInvalidate(
          and(
            eq(workspace.cloudProviderId, daytonaProvider.id),
            eq(workspace.externalInstanceId, sandboxId),
            eq(workspace.status, "running"),
          ),
          { status: "paused", updatedAt: eventDate },
        );

        await Promise.all(
          updated.map((updatedWorkspace) =>
            Promise.all([
              closeUsageSession(updatedWorkspace.id, "provider_auto"),
              deleteAllWorkspaceRouteAccess(updatedWorkspace.id),
              finalizeWorkspaceAgentRuns(updatedWorkspace.id, updatedWorkspace.userId),
            ]),
          ),
        );
        return { updated };
      }

      // destroying / destroyed -> terminated.
      // We act on `destroying` (the started/paused -> destroying transition) so
      // termination is reflected as soon as teardown begins, then `destroyed`
      // confirms it idempotently. No status filter, so this also covers
      // destruction from a paused sandbox.
      if (newState === "destroying" || newState === "destroyed") {
        const updated = await updateWorkspaceStatusAndInvalidate(
          and(
            eq(workspace.cloudProviderId, daytonaProvider.id),
            eq(workspace.externalInstanceId, sandboxId),
            // Don't churn already-terminated rows on the second event.
            or(
              eq(workspace.status, "running"),
              eq(workspace.status, "paused"),
              eq(workspace.status, "pending"),
            ),
          ),
          { status: "terminated", updatedAt: eventDate },
        );

        await Promise.all(
          updated.map((updatedWorkspace) =>
            Promise.all([
              closeUsageSession(updatedWorkspace.id, "provider_auto"),
              deleteAllWorkspaceRouteAccess(updatedWorkspace.id),
              finalizeWorkspaceAgentRuns(updatedWorkspace.id, updatedWorkspace.userId),
            ]),
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
        const githubService = await getGitHubAppService();
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
});

export type InternalRouter = typeof internalRouter;
