import z from "zod";
import {
  workspaceAgentAuthProcedure,
  workspaceAuthProcedure,
  workspaceSetupAuthProcedure,
  router,
} from "../../index";
import { db, eq, and, inArray } from "@gitterm/db";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { workspace } from "@gitterm/db/schema/workspace";
import { workspaceSetup } from "@gitterm/db/schema/workspace-setup";
import { TRPCError } from "@trpc/server";
import { workspaceJWT } from "../../service/auth/workspace-jwt";
import { logger } from "../../utils/logger";
import { encryptWorkspacePassword } from "../../utils/workspace-password";
import { updateWorkspaceByIdAndInvalidate } from "../../service/workspace-mutations";
import {
  deleteWorkspaceRouteAccess,
  upsertWorkspaceRouteAccess,
} from "../../service/workspace-route-access";
import { updateWorkspaceRoutingAndInvalidate } from "../../service/workspace-mutations";
import { getProviderByCloudProviderId } from "../../providers";
import { getWorkspacePortUrl, getWorkspaceUrl } from "../../utils/routing";

const workspacePortSchema = z.number().int().min(1).max(65535);

async function getAuthenticatedWorkspace(workspaceId: string, userId: string) {
  const ws = await db.query.workspace.findFirst({
    where: and(eq(workspace.id, workspaceId), eq(workspace.userId, userId)),
  });
  if (!ws) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  }
  if (ws.status === "terminated") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Workspace is terminated" });
  }
  return ws;
}

/**
 * Workspace operations router
 * All procedures use workspaceAuthProcedure which validates JWT tokens
 *
 * Security flow:
 * 1. JWT token extracted from Authorization: Bearer <token> header
 * 2. Token verified and decoded (checks signature, expiry)
 * 3. Workspace ownership and status validated
 * 4. Scope permissions checked
 */

export const workspaceOperationsRouter = router({
  getSelf: workspaceAuthProcedure.query(async ({ ctx }) => {
    const { workspaceAuth } = ctx;
    if (!workspaceJWT.hasScope(workspaceAuth, "workspace:read")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient workspace scope" });
    }

    const ws = await getAuthenticatedWorkspace(workspaceAuth.workspaceId, workspaceAuth.userId);
    const [provider] = await db
      .select({ providerKey: cloudProvider.providerKey })
      .from(cloudProvider)
      .where(eq(cloudProvider.id, ws.cloudProviderId));

    return {
      id: ws.id,
      name: ws.name,
      status: ws.status,
      repositoryUrl: ws.repositoryUrl,
      repositoryBranch: ws.repositoryBranch,
      baseCommit: ws.repositoryBaseCommit,
      checkoutRef: ws.repositoryCheckoutRef,
      providerKey: provider?.providerKey ?? null,
      url: ws.subdomain && ws.status !== "terminated" ? getWorkspaceUrl(ws.subdomain) : null,
      ports: Object.values(ws.exposedPorts ?? {}).map((entry) => ({
        port: entry.port,
        name: entry.name ?? null,
        url: ws.subdomain ? getWorkspacePortUrl(ws.subdomain, entry.port) : null,
      })),
    };
  }),

  listPorts: workspaceAuthProcedure.query(async ({ ctx }) => {
    const { workspaceAuth } = ctx;
    if (!workspaceJWT.hasScope(workspaceAuth, "port:list")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient port scope" });
    }
    const ws = await getAuthenticatedWorkspace(workspaceAuth.workspaceId, workspaceAuth.userId);
    return Object.values(ws.exposedPorts ?? {}).map((entry) => ({
      port: entry.port,
      name: entry.name ?? null,
      url: ws.subdomain ? getWorkspacePortUrl(ws.subdomain, entry.port) : null,
    }));
  }),

  openPort: workspaceAuthProcedure
    .input(
      z.object({ port: workspacePortSchema, name: z.string().trim().min(1).max(100).optional() }),
    )
    .mutation(async ({ input, ctx }) => {
      const { workspaceAuth } = ctx;
      if (!workspaceJWT.hasScope(workspaceAuth, "port:open")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient port scope" });
      }
      const ws = await getAuthenticatedWorkspace(workspaceAuth.workspaceId, workspaceAuth.userId);
      if (ws.status !== "running") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace must be running" });
      }
      const [provider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, ws.cloudProviderId));
      if (!provider) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cloud provider not found" });
      }

      const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
      const exposed = await computeProvider.createOrGetExposedPortDomain(
        ws.externalInstanceId,
        input.port,
      );
      await updateWorkspaceRoutingAndInvalidate(
        ws.id,
        {
          exposedPorts: {
            ...ws.exposedPorts,
            [input.port]: {
              port: input.port,
              name: input.name,
              upstreamUrl: exposed.domain,
              externalPortDomainId: exposed.externalPortDomainId,
            },
          },
        },
        ws.subdomain,
      );
      if (exposed.upstreamAccess?.headers) {
        await upsertWorkspaceRouteAccess(ws.id, input.port, exposed.upstreamAccess.headers);
      } else {
        await deleteWorkspaceRouteAccess(ws.id, input.port);
      }

      return {
        port: input.port,
        name: input.name ?? null,
        url: ws.subdomain ? getWorkspacePortUrl(ws.subdomain, input.port) : null,
      };
    }),

  closePort: workspaceAuthProcedure
    .input(z.object({ port: workspacePortSchema }))
    .mutation(async ({ input, ctx }) => {
      const { workspaceAuth } = ctx;
      if (!workspaceJWT.hasScope(workspaceAuth, "port:close")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient port scope" });
      }
      const ws = await getAuthenticatedWorkspace(workspaceAuth.workspaceId, workspaceAuth.userId);
      const exposed = ws.exposedPorts?.[input.port];
      if (exposed?.externalPortDomainId) {
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
        const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
        await computeProvider.removeExposedPortDomain(exposed.externalPortDomainId);
      }

      const exposedPorts = { ...ws.exposedPorts };
      delete exposedPorts[input.port];
      await updateWorkspaceRoutingAndInvalidate(ws.id, { exposedPorts }, ws.subdomain);
      await deleteWorkspaceRouteAccess(ws.id, input.port);
      return { port: input.port, closed: true };
    }),

  /**
   * Report the agent's self-issued access credential (e.g. a T3 pairing
   * token). Called from container entrypoints after the agent server boots;
   * SDK providers capture the credential directly instead. Stored encrypted in
   * the workspace's serverPassword slot and surfaced by the dashboard.
   */
  reportAccessCredential: workspaceAgentAuthProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        credential: z.string().min(1).max(4096),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { workspaceAuth } = ctx;

      if (!workspaceJWT.hasScope(workspaceAuth, "agent:credential")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient agent scope" });
      }

      if (workspaceAuth.workspaceId !== input.workspaceId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Token workspace mismatch",
        });
      }

      const [ws] = await db.select().from(workspace).where(eq(workspace.id, input.workspaceId));

      if (!ws) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      if (ws.userId !== workspaceAuth.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Workspace ownership mismatch",
        });
      }

      if (ws.status !== "running" && ws.status !== "pending") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Workspace is not active",
        });
      }

      await updateWorkspaceByIdAndInvalidate(input.workspaceId, {
        serverPassword: encryptWorkspacePassword(input.credential.trim()),
      });

      logger.info("workspace access credential reported", {
        workspaceId: input.workspaceId,
      });

      return { success: true };
    }),

  reportSetupStatus: workspaceSetupAuthProcedure
    .input(
      z.object({
        executionId: z.uuid(),
        status: z.enum(["running", "succeeded", "failed"]),
        exitCode: z.number().int().min(0).max(255).nullable(),
        startedAt: z.iso.datetime().nullable(),
        finishedAt: z.iso.datetime().nullable(),
        logBase64: z.string().max(70_000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { workspaceAuth } = ctx;
      if (!workspaceJWT.hasScope(workspaceAuth, "setup:write")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient setup scope" });
      }

      const ws = await db.query.workspace.findFirst({
        where: and(
          eq(workspace.id, workspaceAuth.workspaceId),
          eq(workspace.userId, workspaceAuth.userId),
        ),
      });
      if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      if (ws.status === "terminated") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Workspace is terminated" });
      }

      const setup = await db.query.workspaceSetup.findFirst({
        where: eq(workspaceSetup.workspaceId, ws.id),
      });
      if (!setup) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace setup not found" });
      if (setup.executionId !== input.executionId) {
        throw new TRPCError({ code: "CONFLICT", message: "Stale workspace setup execution" });
      }
      if (setup.status === "succeeded" || setup.status === "failed") {
        return { accepted: true, status: setup.status };
      }

      const log = input.logBase64
        ? Buffer.from(input.logBase64, "base64")
            .toString("utf8")
            .replaceAll("\0", "")
            .slice(-50_000)
        : null;
      const next = {
        status: input.status,
        exitCode: input.exitCode,
        startedAt: input.startedAt ? new Date(input.startedAt) : setup.startedAt,
        finishedAt: input.finishedAt ? new Date(input.finishedAt) : null,
        log,
        updatedAt: new Date(),
      } as const;
      const allowedStatuses =
        input.status === "running" ? (["waiting"] as const) : (["waiting", "running"] as const);
      const [updated] = await db
        .update(workspaceSetup)
        .set(next)
        .where(
          and(
            eq(workspaceSetup.workspaceId, ws.id),
            inArray(workspaceSetup.status, [...allowedStatuses]),
          ),
        )
        .returning({ status: workspaceSetup.status });

      return { accepted: true, status: updated?.status ?? setup.status };
    }),
});
