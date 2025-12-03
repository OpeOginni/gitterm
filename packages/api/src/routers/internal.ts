import z from "zod";
import { internalProcedure, router } from "../index";
import { db, eq, and, sql, gt } from "@gitpad/db";
import { workspace, usageSession, dailyUsage, type SessionStopSource } from "@gitpad/db/schema/workspace";
import { cloudProvider, region } from "@gitpad/db/schema/cloud";
import { TRPCError } from "@trpc/server";
import { getProviderByCloudProviderId } from "../providers";
import { WORKSPACE_EVENTS } from "../events/workspace";
import { IDLE_TIMEOUT_MINUTES, closeUsageSession } from "../utils/metering";
import { auth } from "@gitpad/auth";

/**
 * Internal router for service-to-service communication
 * All procedures require X-Internal-Key header with valid INTERNAL_API_KEY
 */
export const internalRouter = router({
  // Validate session from cookie (for proxy)
  validateSession: internalProcedure
    .input(z.object({ 
      cookie: z.string().optional(),
    }))
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
    const idleThreshold = new Date(Date.now() - IDLE_TIMEOUT_MINUTES * 60 * 1000);

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
          gt(workspace.lastActiveAt, idleThreshold),
        )
      );

    return idleWorkspaces;
  }),

  // Stop a workspace (for worker)
  stopWorkspaceInternal: internalProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        stopSource: z.enum(["manual", "idle", "quota_exhausted", "error"]),
      })
    )
    .mutation(async ({ input }) => {
      // Get workspace with related data
      const [ws] = await db
        .select()
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
      const [workspaceRegion] = await db
        .select()
        .from(region)
        .where(eq(region.id, ws.regionId));

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
        workspaceRegion.externalRegionIdentifier
      );

      // Close usage session
      const { durationMinutes } = await closeUsageSession(
        input.workspaceId,
        input.stopSource as SessionStopSource
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
});

export type InternalRouter = typeof internalRouter;

