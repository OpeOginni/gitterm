import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { accountProcedure, router } from "../index";
import {
  INTEGRATIONS,
  integrationCatalog,
  type IntegrationKey,
} from "../service/integrations/catalog";
import {
  createConnection,
  createConnectionInput,
  getConnection,
  listConnections,
  removeConnection,
  userIntegrationCatalog,
  type GitHubConnectionDetails,
} from "../service/integrations/connections";
import { getGitHubAppService } from "../service/github";
import {
  isWorkloadIdentityAvailable,
  workloadIdentityIssuer,
} from "../service/workload-identity/google";
import { integrationPolicy } from "../service/integrations/catalog";

const integrationKey = z.enum(Object.keys(INTEGRATIONS) as [IntegrationKey, ...IntegrationKey[]]);

async function githubAppConnection(userId: string, connectionId: string) {
  const connection = await getConnection(userId, connectionId);
  if (!connection || connection.integration !== "github") {
    throw new TRPCError({ code: "NOT_FOUND", message: "GitHub connection not found" });
  }
  const details = connection.details as GitHubConnectionDetails;
  if (details.mode !== "app" || !details.installationId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Repository browsing requires a GitHub App connection",
    });
  }
  return { connection, installationId: details.installationId };
}

/**
 * Integrations as users see them: the admin-enabled catalog plus the connections (personal
 * and shared) they can attach to a workspace. Admin configuration lives under `admin.*`.
 */
export const integrationsRouter = router({
  /** Full policy view including planned integrations; used by the dashboard. */
  list: accountProcedure("integrations:read").query(() => integrationCatalog()),

  /** Only integrations that can be attached right now; intended for SDK consumers. */
  catalog: accountProcedure("integrations:read").query(() => userIntegrationCatalog()),

  connections: router({
    list: accountProcedure("integrations:read")
      .input(
        z
          .object({
            integration: integrationKey.optional(),
            kind: z.enum(["personal", "shared"]).optional(),
          })
          .optional(),
      )
      .query(({ ctx, input }) => listConnections(ctx.session.user.id, input)),

    get: accountProcedure("integrations:read")
      .input(z.object({ id: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const connection = await getConnection(ctx.session.user.id, input.id);
        if (!connection)
          throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
        return connection;
      }),

    create: accountProcedure("integrations:write")
      .input(createConnectionInput)
      .mutation(({ ctx, input }) => createConnection(ctx.session.user.id, input)),

    remove: accountProcedure("integrations:write")
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await removeConnection(ctx.session.user.id, input.id);
        return { success: true as const };
      }),
  }),

  github: router({
    repositories: accountProcedure("integrations:read")
      .input(z.object({ connectionId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const { installationId } = await githubAppConnection(
          ctx.session.user.id,
          input.connectionId,
        );
        return (await getGitHubAppService()).listAccessibleRepos(installationId);
      }),

    branches: accountProcedure("integrations:read")
      .input(
        z.object({
          connectionId: z.string().min(1),
          owner: z.string().min(1),
          repo: z.string().min(1),
        }),
      )
      .query(async ({ ctx, input }) => {
        const { installationId } = await githubAppConnection(
          ctx.session.user.id,
          input.connectionId,
        );
        return (await getGitHubAppService()).listBranches(installationId, input.owner, input.repo);
      }),
  }),

  google: router({
    /** Everything needed to create the Google provider before saving a connection. */
    setup: accountProcedure("integrations:read").query(async () => {
      const available =
        (await integrationPolicy("google")).enabled && (await isWorkloadIdentityAvailable());
      return {
        available,
        issuer: available ? await workloadIdentityIssuer() : null,
        attributeMapping: {
          "google.subject": "assertion.sub",
          "attribute.integration_id": "assertion.integration_id",
        },
      };
    }),
  }),
});
