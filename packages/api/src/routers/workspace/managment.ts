import { randomUUID } from "crypto";
import z from "zod";
import { protectedProcedure, workspaceAuthProcedure, router } from "../../index";
import { db, eq, and, asc, desc, or, ne, SQL, sql } from "@gitterm/db";
import {
  agentWorkspaceConfig,
  workspaceEnvironmentVariables,
  workspace,
  volume,
} from "@gitterm/db/schema/workspace";
import {
  agentType,
  image,
  cloudProvider,
  providerAgentImage,
  region,
} from "@gitterm/db/schema/cloud";
import { user } from "@gitterm/db/schema/auth";
import { TRPCError } from "@trpc/server";
import {
  getOrCreateDailyUsage,
  hasRemainingQuota,
  updateLastActive,
  closeUsageSession,
  createUsageSession,
} from "../../utils/metering";
import { getProviderByCloudProviderId, type PersistentWorkspaceInfo } from "../../providers";
import { createProvisionLogger } from "../../providers/provision-logger";
import { WORKSPACE_EVENTS } from "../../events/workspace";
import {
  getGitHubAppService,
  isGitHubAppConfigured,
  parseGitHubRepoUrl,
} from "../../service/github";
import { workspaceJWT } from "../../service/auth/workspace-jwt";
import { githubAppInstallation, gitIntegration } from "@gitterm/db/schema/integrations";
import { sendWorkspaceCreatedNotification } from "../../utils/discord";
import {
  generateAndEncryptPassword,
  decryptWorkspacePassword,
  encryptWorkspacePassword,
} from "../../utils/workspace-password";
import { getWorkspaceDomain } from "../../utils/routing";
import {
  canUseCustomCloudSubdomain,
  canCreatePersistentWorkspace,
  canUseProvider,
  getDailyMinuteQuotaAsync,
  getWorkspaceLimit,
  type UserPlan,
} from "../../config/features";
import { getProviderConfigService } from "../../service/config/provider-config";
import { buildWorkspaceToolingManifestBase64 } from "../../utils/workspace-tooling";
import { buildWorkspaceEnv, buildWorkspaceProvisioningSpec } from "../../service/workspace-env";
import { getAgentProvisioner, getUserProviderCredentials } from "../../service/agents";
import type { AgentConfigByKind } from "../../service/agents/types";
import { T3_PAIRING_CREATE_COMMAND } from "../../service/agents/t3code";
import { configKindsForAgentType, type AgentConfigKind } from "@gitterm/schema";
import {
  deleteAllWorkspaceRouteAccess,
  deleteWorkspaceRouteAccess,
  upsertWorkspaceRouteAccess,
} from "../../service/workspace-route-access";
import {
  updateWorkspaceByIdAndInvalidate,
  updateWorkspaceByIdReturningAndInvalidate,
  updateWorkspaceRoutingAndInvalidate,
  invalidateWorkspaceCacheAfterMutation,
} from "../../service/workspace-mutations";
import {
  buildProjectPathHint,
  normalizeProvidersshAccessSupport,
  pickWorkspaceImage,
  WORKSPACE_PROFILES,
  type WorkspaceProfile,
} from "../../providers/ssh-access";
import { normalizeSshPublicKey } from "../../utils/ssh-public-key";
import { imageSupportsProvider } from "../../providers/image-compat";
import type { CloudProviderType, ImageProviderMetadata } from "@gitterm/db/schema/cloud";
import { normalizeBaseCommit } from "../../utils/workspace-base-commit";
import {
  buildWorkspaceRuntimeAccess,
  isResumableWorkspaceStatus,
} from "../../service/workspace-runtime";
import { getWorkspaceRouteAccess } from "../../service/workspace-route-access";

// Reserved subdomains that cannot be used by users
const RESERVED_SUBDOMAINS = [
  "api",
  "www",
  "app",
  "admin",
  "dashboard",
  "cdn",
  "static",
  "assets",
  "mail",
  "email",
  "ftp",
  "ssh",
  "docs",
  "blog",
  "status",
  "support",
];

function isSubdomainReserved(subdomain: string): boolean {
  return RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase());
}

function normalizeRepoUrl(url: string): string {
  const trimmed = url
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  const parsed = parseGitHubRepoUrl(trimmed);

  if (parsed) {
    return `https://github.com/${parsed.owner}/${parsed.repo}`;
  }

  return trimmed.replace(/\.git\/?$/i, "");
}

async function getConfiguredDefaultRegionIdentifier(
  provider: CloudProviderType,
): Promise<string | undefined> {
  if (!provider.providerConfigId) {
    return undefined;
  }

  const providerConfig = await getProviderConfigService().getProviderConfigById(
    provider.providerConfigId,
  );
  if (!providerConfig?.isEnabled) {
    return undefined;
  }

  const defaultRegionIdentifier =
    providerConfig.config.defaultTargetRegion?.trim() ??
    providerConfig.config.defaultRegion?.trim();

  return defaultRegionIdentifier || undefined;
}

export const workspaceRouter = router({
  listUserInstallations: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    const installations = await db
      .select()
      .from(gitIntegration)
      .innerJoin(
        githubAppInstallation,
        eq(gitIntegration.providerInstallationId, githubAppInstallation.installationId),
      )
      .where(eq(gitIntegration.userId, userId));

    return {
      success: true,
      installations,
    };
  }),

  /**
   * Get the current user's subdomain permissions.
   * Used by the frontend to conditionally show subdomain input fields.
   */
  getSubdomainPermissions: protectedProcedure.query(async ({ ctx }) => {
    const userPlan = ctx.session.user.plan;

    if (!userPlan) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    return {
      canUseCustomCloudSubdomain: canUseCustomCloudSubdomain(userPlan as UserPlan),
      userPlan,
    };
  }),

  // List all agent types
  listAgentTypes: protectedProcedure
    .input(
      z
        .object({
          serverOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      let whereClause: SQL<unknown> | undefined = eq(agentType.isEnabled, true);

      if (input?.serverOnly) {
        whereClause = and(whereClause, eq(agentType.serverOnly, true));
      }

      try {
        const types = await db.select().from(agentType).where(whereClause);
        return {
          success: true,
          agentTypes: types,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch agent types",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // List images for a specific agent type
  listImages: protectedProcedure
    .input(z.object({ agentTypeId: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const images = await db
          .select()
          .from(image)
          .where(and(eq(image.agentTypeId, input.agentTypeId), eq(image.isEnabled, true)));
        return {
          success: true,
          images,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch images",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // List cloud providers
  listCloudProviders: protectedProcedure
    .input(
      z
        .object({
          localOnly: z.boolean().optional(),
          cloudOnly: z.boolean().optional(),
          sandboxOnly: z.boolean().optional(),
          nonSandboxOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      let whereClause: SQL<unknown> | undefined = eq(cloudProvider.isEnabled, true);

      if (input?.localOnly) {
        whereClause = and(whereClause, eq(cloudProvider.name, "Local"));
      }

      if (input?.cloudOnly) {
        whereClause = and(whereClause, ne(cloudProvider.name, "Local"));
      }

      if (input?.sandboxOnly) {
        whereClause = and(whereClause, eq(cloudProvider.isSandbox, true));
      }

      if (input?.nonSandboxOnly) {
        whereClause = and(whereClause, eq(cloudProvider.isSandbox, false));
      }

      try {
        const providers = await db.query.cloudProvider.findMany({
          where: whereClause,
          with: {
            regions: {
              where: eq(region.isEnabled, true),
              orderBy: [asc(region.name)],
            },
          },
          orderBy: [desc(cloudProvider.preferredDefault), asc(cloudProvider.name)],
        });

        // Plan-based provider gating: free tier only sees E2B (and Local).
        // Paid plans and self-hosted see everything. Done in-memory so the
        // gating rules live in one place (config/features).
        const viewerPlan = ((ctx.session.user as { plan?: UserPlan }).plan ?? "free") as UserPlan;
        const planVisibleProviders = providers.filter((provider) => {
          const providerKey = (provider.providerKey ?? "local").toLowerCase();
          if (providerKey === "local") return true;
          return canUseProvider(viewerPlan, providerKey);
        });

        const providersWithEditorSupport = await Promise.all(
          planVisibleProviders.map(async (provider) => {
            let regions = provider.regions;

            if (provider.providerKey === "aws") {
              // AWS providers are region-scoped (one cloud_provider row per region).
              // The pinned region is the region row attached to this provider.
              // We oldest-first sort to make this deterministic across legacy data
              // where multiple region rows may be attached.
              const sorted = [...regions].toSorted(
                (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
              );
              regions = sorted.slice(0, 1);
            } else if (
              provider.supportsRegions &&
              !provider.allowUserRegionSelection &&
              regions.length > 0
            ) {
              const configuredDefaultRegionIdentifier =
                await getConfiguredDefaultRegionIdentifier(provider);

              const lockedRegion = configuredDefaultRegionIdentifier
                ? regions.find(
                    (providerRegion) =>
                      providerRegion.externalRegionIdentifier === configuredDefaultRegionIdentifier,
                  )
                : regions[0];

              regions = lockedRegion ? [lockedRegion] : regions.slice(0, 1);
            }

            return {
              ...provider,
              regions,
              sshAccessSupport: normalizeProvidersshAccessSupport(provider.sshAccessSupport),
            };
          }),
        );

        return {
          success: true,
          cloudProviders: providersWithEditorSupport,
        };
      } catch (error) {
        console.error("Failed to fetch cloud providers", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch cloud providers",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // List all workspaces for the authenticated user (paginated)
  listWorkspaces: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).default(12),
          offset: z.number().min(0).default(0),
          status: z.enum(["all", "active", "terminated"]).default("active"),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { limit = 12, offset = 0, status = "active" } = input ?? {};

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      try {
        // Build where clause based on status filter
        const statusCondition =
          status === "all"
            ? eq(workspace.userId, userId)
            : status === "terminated"
              ? and(eq(workspace.userId, userId), eq(workspace.status, "terminated"))
              : and(
                  eq(workspace.userId, userId),
                  or(
                    eq(workspace.status, "running"),
                    eq(workspace.status, "pending"),
                    eq(workspace.status, "paused"),
                  ),
                );

        // Get total count using efficient COUNT query
        const [countResult] = await db
          .select({ count: sql<number>`count(*)` })
          .from(workspace)
          .where(statusCondition);

        const total = Number(countResult?.count ?? 0);

        // Fetch paginated workspaces
        const workspaces = await db.query.workspace.findMany({
          where: statusCondition,
          with: {
            image: {
              with: {
                agentType: true,
              },
            },
          },
          orderBy: (workspace, { desc }) =>
            status === "terminated"
              ? [desc(workspace.terminatedAt), desc(workspace.startedAt)]
              : [desc(workspace.startedAt)],
          limit,
          offset,
        });

        // Decrypt server passwords for serverOnly workspaces
        const workspacesWithDecryptedPasswords = workspaces.map((ws) => {
          if (ws.serverPassword && ws.serverOnly) {
            try {
              return {
                ...ws,
                serverPassword: decryptWorkspacePassword(ws.serverPassword),
              };
            } catch (error) {
              console.error(`Failed to decrypt password for workspace ${ws.id}:`, error);
              // Return without password if decryption fails
              return {
                ...ws,
                serverPassword: null,
              };
            }
          }
          return ws;
        });

        return {
          success: true,
          workspaces: workspacesWithDecryptedPasswords,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + workspaces.length < total,
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch workspaces",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  getWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      try {
        const workspaceRecord = await db.query.workspace.findFirst({
          where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
          with: {
            image: {
              with: {
                agentType: true,
              },
            },
          },
        });

        if (!workspaceRecord) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workspace not found",
          });
        }

        let workspaceWithPassword = workspaceRecord;
        if (workspaceRecord.serverPassword && workspaceRecord.serverOnly) {
          try {
            workspaceWithPassword = {
              ...workspaceRecord,
              serverPassword: decryptWorkspacePassword(workspaceRecord.serverPassword),
            };
          } catch (error) {
            console.error(`Failed to decrypt password for workspace ${workspaceRecord.id}:`, error);
            workspaceWithPassword = {
              ...workspaceRecord,
              serverPassword: null,
            };
          }
        }

        return {
          success: true,
          workspace: workspaceWithPassword,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch workspace",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  /**
   * Mint a fresh agent access credential (e.g. a T3 pairing token — they are
   * one-time, so pairing a second device needs a new one). Only supported for
   * agents that issue their own credentials, on providers that can exec.
   */
  regenerateAccessCredential: protectedProcedure
    .input(z.object({ workspaceId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const workspaceRecord = await db.query.workspace.findFirst({
        where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
        with: {
          image: {
            with: {
              agentType: true,
            },
          },
        },
      });

      if (!workspaceRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }

      if (workspaceRecord.status !== "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Workspace must be running to generate a new pairing link",
        });
      }

      const agentTypeName = workspaceRecord.image?.agentType?.name ?? "";
      if (!agentTypeName.trim().toLowerCase().startsWith("t3code")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This agent does not issue pairing credentials",
        });
      }

      const [provider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, workspaceRecord.cloudProviderId));

      if (!provider) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cloud provider not found" });
      }

      const computeProvider = await getProviderByCloudProviderId(provider.providerKey);

      if (!computeProvider.execCommand) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This provider cannot generate new pairing links; restart the workspace instead",
        });
      }

      const result = await computeProvider.execCommand(
        workspaceRecord.externalInstanceId,
        T3_PAIRING_CREATE_COMMAND,
      );

      const credential = result.stdout.trim();
      if (result.exitCode !== 0 || !credential) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate a new pairing token",
        });
      }

      await updateWorkspaceByIdAndInvalidate(input.workspaceId, {
        serverPassword: encryptWorkspacePassword(credential),
      });

      return { success: true, credential };
    }),

  getWorkspaceSSHAccess: protectedProcedure
    .input(
      z.object({
        workspaceId: z.uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const [workspaceRecord] = await db
        .select()
        .from(workspace)
        .where(and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)))
        .limit(1);

      if (!workspaceRecord) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      if (!workspaceRecord.editorAccessEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Editor access is not enabled for this workspace.",
        });
      }

      if (workspaceRecord.status !== "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Start the workspace before generating editor SSH access.",
        });
      }

      const [providerRecord] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, workspaceRecord.cloudProviderId))
        .limit(1);

      if (!providerRecord) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Workspace provider not found",
        });
      }

      let regionIdentifier: string | undefined;

      if (workspaceRecord.regionId) {
        const [workspaceRegion] = await db
          .select()
          .from(region)
          .where(eq(region.id, workspaceRecord.regionId))
          .limit(1);
        regionIdentifier = workspaceRegion?.externalRegionIdentifier;
      }

      try {
        const computeProvider = await getProviderByCloudProviderId(providerRecord.providerKey);
        const access = await computeProvider.getWorkspaceSSHAccess({
          workspaceId: workspaceRecord.id,
          userId,
          externalServiceId: workspaceRecord.externalInstanceId,
          subdomain: workspaceRecord.subdomain ?? workspaceRecord.id,
          projectPathHint: buildProjectPathHint(workspaceRecord.repositoryUrl),
          regionIdentifier,
          existingConnection: workspaceRecord.sshConnection ?? undefined,
        });

        if (access.connection) {
          await db
            .update(workspace)
            .set({
              sshConnection: access.connection,
              updatedAt: new Date(),
            })
            .where(eq(workspace.id, workspaceRecord.id));
        }

        return {
          success: true,
          access,
          workspaceProfile: workspaceRecord.workspaceProfile,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to generate editor access details",
        });
      }
    }),

  // Create or update environment variables for a workspace
  createEnvironmentVariables: protectedProcedure
    .input(
      z.object({
        agentTypeId: z.string().min(1, "Agent type ID is required"),
        environmentVariables: z
          .record(z.string(), z.string())
          .refine((obj) => Object.keys(obj).length > 0, {
            message: "Environment variables cannot be empty",
          }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      try {
        // Check if environment variables already exist
        const existingVars = await db
          .select()
          .from(workspaceEnvironmentVariables)
          .where(
            and(
              eq(workspaceEnvironmentVariables.userId, userId),
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId),
            ),
          );

        if (existingVars.length > 0) {
          // Update existing environment variables
          const [updatedVars] = await db
            .update(workspaceEnvironmentVariables)
            .set({
              environmentVariables: input.environmentVariables,
              updatedAt: new Date(),
            })
            .where(eq(workspaceEnvironmentVariables.id, existingVars[0]!.id))
            .returning();

          return {
            success: true,
            message: "Environment variables updated successfully",
            environmentVariables: updatedVars,
          };
        } else {
          // Create new environment variables
          const [newVars] = await db
            .insert(workspaceEnvironmentVariables)
            .values({
              userId,
              agentTypeId: input.agentTypeId,
              environmentVariables: input.environmentVariables,
            })
            .returning();

          return {
            success: true,
            message: "Environment variables created successfully",
            environmentVariables: newVars,
          };
        }
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create or update environment variables",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Get environment variables for a specific agent type
  getEnvironmentVariables: protectedProcedure
    .input(
      z.object({
        agentTypeId: z.string().min(1, "Agent type ID is required"),
      }),
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      try {
        const vars = await db
          .select()
          .from(workspaceEnvironmentVariables)
          .where(
            and(
              eq(workspaceEnvironmentVariables.userId, userId),
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId),
            ),
          );

        if (vars.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Environment variables not found for this agent type",
          });
        }

        return {
          success: true,
          environmentVariables: vars[0]!,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch environment variables",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // List all environment variables for the authenticated user
  listEnvironmentVariables: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    try {
      const vars = await db
        .select()
        .from(workspaceEnvironmentVariables)
        .where(eq(workspaceEnvironmentVariables.userId, userId));

      return {
        success: true,
        environmentVariables: vars,
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch environment variables",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  // Delete environment variables
  deleteEnvironmentVariables: protectedProcedure
    .input(
      z.object({
        agentTypeId: z.string().min(1, "Agent type ID is required"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      try {
        const vars = await db
          .select()
          .from(workspaceEnvironmentVariables)
          .where(
            and(
              eq(workspaceEnvironmentVariables.userId, userId),
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId),
            ),
          );

        if (vars.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Environment variables not found",
          });
        }

        await db
          .delete(workspaceEnvironmentVariables)
          .where(eq(workspaceEnvironmentVariables.id, vars[0]!.id));

        return {
          success: true,
          message: "Environment variables deleted successfully",
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete environment variables",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Update a specific environment variable
  updateEnvironmentVariable: protectedProcedure
    .input(
      z.object({
        agentTypeId: z.string().min(1, "Agent type ID is required"),
        key: z.string().min(1, "Key is required"),
        value: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      try {
        const vars = await db
          .select()
          .from(workspaceEnvironmentVariables)
          .where(
            and(
              eq(workspaceEnvironmentVariables.userId, userId),
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId),
            ),
          );

        if (vars.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Environment variables not found for this agent type",
          });
        }

        const updatedEnvVars = {
          ...(vars[0]!.environmentVariables as Record<string, string>),
          [input.key]: input.value,
        };

        const [updated] = await db
          .update(workspaceEnvironmentVariables)
          .set({
            environmentVariables: updatedEnvVars,
            updatedAt: new Date(),
          })
          .where(eq(workspaceEnvironmentVariables.id, vars[0]!.id))
          .returning();

        return {
          success: true,
          message: "Environment variable updated successfully",
          environmentVariables: updated,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update environment variable",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // ============================================================================
  // Metering & Quota Endpoints
  // ============================================================================

  // Get daily usage for the authenticated user
  getDailyUsage: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    try {
      const plan = ((ctx.session.user as { plan?: UserPlan }).plan ?? "free") as UserPlan;
      const usage = await getOrCreateDailyUsage(userId, plan);
      const dailyQuota = await getDailyMinuteQuotaAsync(plan);
      return {
        success: true,
        minutesUsed: usage.minutesUsed,
        minutesRemaining: usage.minutesRemaining,
        dailyLimit: Number.isFinite(dailyQuota) ? dailyQuota : null,
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch daily usage",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  // Check if user can start a new workspace (has remaining quota)
  checkQuota: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    try {
      const plan = ((ctx.session.user as { plan?: UserPlan }).plan ?? "free") as UserPlan;
      const canStart = await hasRemainingQuota(userId, plan);
      const usage = await getOrCreateDailyUsage(userId, plan);
      const dailyQuota = await getDailyMinuteQuotaAsync(plan);

      return {
        success: true,
        canStartWorkspace: canStart,
        minutesRemaining: usage.minutesRemaining,
        dailyLimit: Number.isFinite(dailyQuota) ? dailyQuota : null,
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to check quota",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  // Heartbeat endpoint for workspace agents (uses JWT auth)
  heartbeat: workspaceAuthProcedure
    .input(
      z.object({
        workspaceId: z.uuid(),
        timestamp: z.number().optional(),
        cpu: z.number().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { workspaceAuth } = ctx;

      // Verify workspace ID matches token
      if (workspaceAuth.workspaceId !== input.workspaceId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Token workspace mismatch",
        });
      }

      try {
        // Verify workspace exists
        const [existingWorkspace] = await db
          .select()
          .from(workspace)
          .where(eq(workspace.id, input.workspaceId));

        if (!existingWorkspace) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workspace not found",
          });
        }

        // Verify ownership
        if (existingWorkspace.userId !== workspaceAuth.userId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Workspace ownership mismatch",
          });
        }

        // Check if workspace is still allowed to run (quota check)
        const hasQuota = await hasRemainingQuota(existingWorkspace.userId);

        if (!hasQuota) {
          // User exceeded quota - signal shutdown
          return {
            success: true,
            action: "shutdown" as const,
            reason: "quota_exhausted",
          };
        }

        // Update last active timestamp
        await updateLastActive(input.workspaceId);

        return {
          success: true,
          action: "continue" as const,
          reason: null,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process heartbeat",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Create a new workspace
  createWorkspace: protectedProcedure
    .input(
      z.object({
        name: z.string().optional(),
        repo: z.string().optional(), // Optional for local workspaces
        branch: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .regex(/^[A-Za-z0-9._/-]+$/)
          .optional(),
        baseCommit: z.string().trim().min(1).max(64).optional(),
        checkoutRef: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .regex(/^[A-Za-z0-9._/-]+$/)
          .optional(),
        subdomain: z
          .union([
            z
              .string()
              .min(1)
              .max(63)
              .regex(/^[a-z0-9-]+$/),
            z.literal(""),
          ])
          .optional(),
        agentTypeId: z.string(),
        cloudProviderId: z.string(),
        regionId: z.string().optional(),
        gitIntegrationId: z.string().optional(),
        persistent: z.boolean(),
        workspaceProfile: z.enum(WORKSPACE_PROFILES).default("standard").optional(),
        modelCredentialIds: z.array(z.uuid()).max(50).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const workspaceId = randomUUID();
      const workspaceCreateLogger = createProvisionLogger("workspace-router", workspaceId);

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      let resolvedBaseCommit: string | null = null;
      try {
        resolvedBaseCommit = normalizeBaseCommit(input.baseCommit);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Invalid baseCommit",
        });
      }
      const resolvedCheckoutRef = input.checkoutRef?.trim() || null;

      const [fetchedUser] = await db.select().from(user).where(eq(user.id, userId));

      if (!fetchedUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Validate that the provided repo is publicly clonable using `git ls-remote`
      if (input.repo) {
        input.repo = normalizeRepoUrl(input.repo);

        // Only support HTTPS URLs for now; `.git` suffix is added later if missing
        if (!/^https:\/\/.+$/i.test(input.repo)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Repository URL must be a valid HTTPS Git URL",
          });
        }
      }

      try {
        // Get cloud provider info first to determine if local
        const [cloudProviderRecord] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.id, input.cloudProviderId));

        if (!cloudProviderRecord) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid cloud provider",
          });
        }

        if (!cloudProviderRecord.isEnabled) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected cloud provider is not available",
          });
        }

        const providerConfigService = getProviderConfigService();

        const providerKey = (cloudProviderRecord.providerKey ?? "local").toLowerCase();

        if (providerKey !== "local") {
          if (!cloudProviderRecord.providerConfigId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Selected cloud provider is missing configuration",
            });
          }

          const providerConfig = await providerConfigService.getProviderConfigById(
            cloudProviderRecord.providerConfigId,
          );

          if (!providerConfig || !providerConfig.isEnabled) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Selected cloud provider is not configured",
            });
          }
        }

        // Determine if this is a local workspace
        const isLocal = providerKey === "local";

        // Plan-based provider gating. Free tier may only use E2B; all paid
        // plans (and self-hosted) may use any enabled provider. Local
        // workspaces don't consume our managed compute, so they're exempt.
        const planForGating = (fetchedUser.plan || "free") as UserPlan;
        if (!isLocal && !canUseProvider(planForGating, providerKey)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "The Free plan can only use E2B sandboxes. Upgrade to Starter or Pro to use this provider.",
          });
        }

        const workspaceProfile = (input.workspaceProfile ?? "standard") as WorkspaceProfile;
        const editorAccessEnabled = workspaceProfile === "ssh-enabled";
        const providerEditorSupport = normalizeProvidersshAccessSupport(
          cloudProviderRecord.sshAccessSupport,
        );

        if (editorAccessEnabled) {
          const requiresUserSshKey = providerKey !== "daytona";
          if (requiresUserSshKey && !fetchedUser.sshPublicKey) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Add an SSH public key in Settings before enabling editor access for this provider.",
            });
          }

          if (!providerEditorSupport.supported) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${cloudProviderRecord.name} does not currently support editor SSH access.`,
            });
          }
        }

        // Check quota only for cloud workspaces (local doesn't use our resources)
        if (!isLocal) {
          const hasQuota = await hasRemainingQuota(userId, planForGating);
          if (!hasQuota) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                planForGating === "pro"
                  ? "Daily cloud runtime limit reached. It resets at midnight UTC."
                  : "Daily cloud runtime limit reached. It resets at midnight UTC, or upgrade for more runtime.",
            });
          }
        }

        const runningWorkspaces = await db
          .select()
          .from(workspace)
          .where(
            and(
              eq(workspace.userId, userId),
              or(
                eq(workspace.status, "running"),
                eq(workspace.status, "pending"),
                eq(workspace.status, "paused"),
              ),
            ),
          );

        // Check workspace limit based on plan
        const userPlanForLimit = (fetchedUser.plan || "free") as UserPlan;
        const workspaceLimit = getWorkspaceLimit(userPlanForLimit);

        if (runningWorkspaces.length >= workspaceLimit) {
          const upgradeHint =
            userPlanForLimit === "free"
              ? ` Upgrade to Starter (5) or Pro (15) for more.`
              : userPlanForLimit === "starter"
                ? ` Upgrade to Pro for up to 15.`
                : "";
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              `You've reached your plan limit of ${workspaceLimit} workspaces.` +
              (upgradeHint || " Delete some workspaces to create new ones."),
          });
        }

        // For cloud workspaces, repo is required
        if (!isLocal && !input.repo) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Repository URL is required for cloud workspaces",
          });
        }

        // Get region info
        let regionRecord: typeof region.$inferSelect | undefined;

        if (cloudProviderRecord.supportsRegions) {
          if (providerKey === "aws") {
            // AWS providers are region-scoped: each cloud_provider row represents
            // exactly one AWS region, set when the provider was created via
            // `aws.createRegionProvider`. The pinned region is the region row
            // attached to this specific cloud_provider - NOT anything stored on
            // the shared providerConfig blob (which only holds credentials).
            //
            // Reading region from providerConfig.defaultRegion would silently
            // route deploys to the wrong region when:
            //   - the provider hasn't been bootstrapped yet (providerConfigId null)
            //   - the providerConfig points to a stale/shared default config
            // Always resolve via the attached region row.
            [regionRecord] = await db
              .select()
              .from(region)
              .where(
                and(eq(region.cloudProviderId, input.cloudProviderId), eq(region.isEnabled, true)),
              )
              .orderBy(asc(region.createdAt))
              .limit(1);

            if (!regionRecord) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "This AWS provider has no enabled region attached. Re-create the provider with a valid region.",
              });
            }
          } else if (cloudProviderRecord.allowUserRegionSelection) {
            // User can select - validate the provided region
            if (input.regionId) {
              [regionRecord] = await db
                .select()
                .from(region)
                .where(
                  and(
                    eq(region.id, input.regionId),
                    eq(region.cloudProviderId, input.cloudProviderId),
                  ),
                );

              if (!regionRecord) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Invalid region for the selected cloud provider",
                });
              }

              if (!regionRecord.isEnabled) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Selected region is not available",
                });
              }
            } else {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Region is required for the selected cloud provider",
              });
            }
          } else {
            // User cannot select - use the default region from provider config
            const defaultRegionIdentifier =
              await getConfiguredDefaultRegionIdentifier(cloudProviderRecord);

            if (defaultRegionIdentifier) {
              [regionRecord] = await db
                .select()
                .from(region)
                .where(
                  and(
                    eq(region.externalRegionIdentifier, defaultRegionIdentifier),
                    eq(region.cloudProviderId, input.cloudProviderId),
                    eq(region.isEnabled, true),
                  ),
                );
            }

            // If no default region found or not enabled, fall back to any enabled
            // region attached to this provider.
            if (!regionRecord) {
              const [anyEnabledRegion] = await db
                .select()
                .from(region)
                .where(
                  and(
                    eq(region.cloudProviderId, input.cloudProviderId),
                    eq(region.isEnabled, true),
                  ),
                )
                .orderBy(asc(region.name))
                .limit(1);

              regionRecord = anyEnabledRegion;
            }

            if (!regionRecord) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "No available region found for the selected cloud provider",
              });
            }
          }
        }

        // Get image for this agent type (take the first one)
        const imageRecords = await db
          .select()
          .from(image)
          .where(and(eq(image.agentTypeId, input.agentTypeId), eq(image.isEnabled, true)))
          .orderBy(desc(image.updatedAt));

        const [agentTypeRecord] = await db
          .select()
          .from(agentType)
          .where(eq(agentType.id, input.agentTypeId));

        if (!agentTypeRecord) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No agent type found for this agent type",
          });
        }

        if (!agentTypeRecord.isEnabled) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected agent type is not available",
          });
        }

        // Local workspaces can only use serverOnly agent types
        if (isLocal && !agentTypeRecord.serverOnly) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Local workspaces can only use server-only agent types",
          });
        }

        if (editorAccessEnabled && !agentTypeRecord.serverOnly) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Editor access currently requires a server-only agent type.",
          });
        }

        const assignedProviderImage = await db.query.providerAgentImage.findFirst({
          where: and(
            eq(providerAgentImage.cloudProviderId, input.cloudProviderId),
            eq(providerAgentImage.agentTypeId, input.agentTypeId),
            sql`coalesce(${providerAgentImage.workspaceProfile}, 'standard') = ${workspaceProfile}`,
          ),
          with: {
            image: true,
          },
        });

        // An assignment is only usable if its image actually carries the
        // provider metadata required to provision on the selected provider.
        // Otherwise (e.g. an AWS-only image assigned to E2B) we ignore it and
        // fall back to a profile-aware pick among provider-compatible images.
        const assignedImage = assignedProviderImage?.image;
        const assignmentUsable =
          assignedImage?.isEnabled === true &&
          imageSupportsProvider(
            providerKey,
            assignedImage.providerMetadata as ImageProviderMetadata | null,
          );

        const compatibleImageRecords = imageRecords.filter((img) =>
          imageSupportsProvider(providerKey, img.providerMetadata as ImageProviderMetadata | null),
        );

        const imageRecord = assignmentUsable
          ? assignedImage
          : pickWorkspaceImage(compatibleImageRecords, workspaceProfile);

        if (!imageRecord) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No enabled image found for this agent type",
          });
        }

        const applicableKinds = configKindsForAgentType(agentTypeRecord.name);
        const agentConfigs: AgentConfigByKind = {};
        if (applicableKinds.length > 0) {
          const rows = await db
            .select()
            .from(agentWorkspaceConfig)
            .where(eq(agentWorkspaceConfig.userId, userId))
            .orderBy(desc(agentWorkspaceConfig.updatedAt));

          for (const kind of applicableKinds) {
            const row = rows.find((r) => r.kind === kind);
            if (row) {
              agentConfigs[kind as AgentConfigKind] = row.config as Record<string, unknown>;
            }
          }
        }

        // Fetch user's workspace environment variables
        const [userWorkspaceEnvironmentVariables] = await db
          .select()
          .from(workspaceEnvironmentVariables)
          .where(
            and(
              eq(workspaceEnvironmentVariables.userId, userId),
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId),
            ),
          );

        // Get GitHub username from user.name (set during OAuth)
        const [userRecord] = await db.select().from(user).where(eq(user.id, userId));

        const githubUsername = userRecord?.name ?? undefined;

        // Validate git integration / repo access first, then generate token if needed
        let githubAppToken: string | undefined;
        let githubAppTokenExpiry: string | undefined;
        let githubInstallationId: string | undefined;
        let selectedGitIntegration: typeof gitIntegration.$inferSelect | undefined;

        if (input.gitIntegrationId) {
          if (!isGitHubAppConfigured()) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "GitHub App is not configured for this deployment",
            });
          }
          const [gitIntegrationRecord] = await db
            .select()
            .from(gitIntegration)
            .where(
              and(eq(gitIntegration.id, input.gitIntegrationId), eq(gitIntegration.userId, userId)),
            );

          if (!gitIntegrationRecord) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Git integration not found",
            });
          }

          if (gitIntegrationRecord.provider !== "github") {
            // TODO: Support other git providers
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid git provider",
            });
          }
          selectedGitIntegration = gitIntegrationRecord;
        }

        if (input.repo) {
          if (!isGitHubAppConfigured()) {
            const parsed = parseGitHubRepoUrl(input.repo);
            if (!parsed) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Invalid repository URL",
              });
            }
          } else {
            const [userExistingGithubAppInstallation] = await db
              .select()
              .from(githubAppInstallation)
              .where(eq(githubAppInstallation.userId, userId))
              .limit(1);

            const options = selectedGitIntegration
              ? { userId: userId, gitIntegrationId: selectedGitIntegration.id }
              : undefined;

            const repoValidation = await getGitHubAppService().checkIfValidRepository(
              input.repo,
              options,
              input.branch,
            );

            if (!repoValidation.valid)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Invalid repository URL",
              });

            if (!repoValidation.exists) {
              if (!selectedGitIntegration && userExistingGithubAppInstallation) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message:
                    "Can't access repository. Configure Repository Access to use private repos (connect one in Integrations if needed).",
                });
              }

              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Can't access repository, check URL or github integration",
              });
            }

            if (!repoValidation.canClone)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Can't clone repository, check github integration",
              });

            if (input.branch && !repoValidation.branchExists)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Branch "${input.branch}" not found in this repository`,
              });
          }
        }

        if (selectedGitIntegration) {
          const installation = await getGitHubAppService().getUserInstallation(
            userId,
            selectedGitIntegration.providerInstallationId,
          );

          if (installation && !installation.suspended) {
            const repoName = parseGitHubRepoUrl(input.repo || "")?.repo;

            githubInstallationId = installation.installationId;
            try {
              const tokenData = await getGitHubAppService().getUserToServerToken(
                installation.installationId,
                repoName ? [repoName] : undefined,
              );
              githubAppToken = tokenData.token;
              githubAppTokenExpiry = tokenData.expiresAt;
            } catch (error) {
              console.error("Failed to generate GitHub App token:", error);
              // Continue without token - user can still use workspace without git operations
            }
          }
        }

        // Parse repo URL to get owner/name (only for cloud workspaces)
        const repoInfo = input.repo ? parseGitHubRepoUrl(input.repo) : null;

        // Resolve exact base commit when not provided by the caller.
        if (input.repo && !resolvedBaseCommit) {
          try {
            const headSha = await getGitHubAppService().resolveBranchHeadSha(
              input.repo,
              input.branch,
              selectedGitIntegration
                ? {
                    userId,
                    gitIntegrationId: selectedGitIntegration.id,
                    installationId: githubInstallationId,
                  }
                : undefined,
            );
            if (headSha) {
              resolvedBaseCommit = normalizeBaseCommit(headSha);
            }
          } catch (error) {
            console.warn("Failed to resolve baseCommit from branch head:", error);
          }
        }

        // Generate or validate subdomain
        let subdomain: string;
        const userPlan = (fetchedUser.plan || "free") as UserPlan;

        if (input.subdomain) {
          // User wants a custom subdomain

          // Check if subdomain is reserved
          if (isSubdomainReserved(input.subdomain)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Subdomain '${input.subdomain}' is reserved and cannot be used`,
            });
          }

          if (!canUseCustomCloudSubdomain(userPlan)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Custom cloud subdomains require a Pro plan.",
            });
          }

          // Check uniqueness - only among running/pending workspaces
          const [existing] = await db
            .select()
            .from(workspace)
            .where(
              and(
                eq(workspace.subdomain, input.subdomain),
                or(eq(workspace.status, "running"), eq(workspace.status, "pending")),
              ),
            )
            .limit(1);

          if (existing) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Subdomain already taken",
            });
          }

          subdomain = input.subdomain;
        } else {
          // No custom subdomain provided - generate one automatically
          // Format: {first2sections} e.g., abc12345-def67890
          let attempts = 0;
          do {
            if (attempts > 10) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to generate unique subdomain",
              });
            }
            const uuid = randomUUID();
            const uuidParts = uuid.split("-");
            subdomain = `${uuidParts[0]}`;
            attempts++;

            // Check if generated subdomain is reserved (unlikely but possible)
            if (isSubdomainReserved(subdomain)) {
              continue;
            }
          } while (
            await db
              .select()
              .from(workspace)
              .where(eq(workspace.subdomain, subdomain))
              .limit(1)
              .then((rows) => rows.length > 0)
          );
        }

        // Generate workspace-scoped JWT token (replaces shared INTERNAL_API_KEY)
        const workspaceAuthToken = workspaceJWT.generateToken(
          workspaceId,
          userId,
          ["port:*"], // All git scopes
        );

        // API endpoint for workspace operations
        const WORKSPACE_API_URL =
          process.env.WORKSPACE_API_URL ||
          process.env.INTERNAL_API_URL ||
          "https://api.gitterm.dev/trpc";

        // Generate domain using routing utils
        // In path mode: returns just subdomain (stored for lookup)
        // In subdomain mode: returns subdomain.baseDomain
        const domain = getWorkspaceDomain(subdomain);

        const WORKSPACE_TOOLING_MANIFEST_BASE64 = await workspaceCreateLogger.step(
          "build-tooling-manifest",
          () =>
            buildWorkspaceToolingManifestBase64({
              owner: repoInfo?.owner,
              repo: repoInfo?.repo,
              installationId: githubInstallationId,
            }),
        );

        // Generate server password for serverOnly workspaces
        let serverPassword: string | undefined;
        let encryptedServerPassword: string | undefined;

        if (agentTypeRecord.serverOnly) {
          const passwordData = generateAndEncryptPassword();
          serverPassword = passwordData.password;
          encryptedServerPassword = passwordData.encryptedPassword;
        }

        const agentProvisioning = getAgentProvisioner(agentTypeRecord.name).provision({
          userId,
          userDisplayName: fetchedUser.name,
          workspaceHostname: `${subdomain}.${process.env.BASE_DOMAIN ?? "gitterm.dev"}`,
          agentTypeName: agentTypeRecord.name,
          serverOnly: agentTypeRecord.serverOnly,
          agentConfigs,
          serverPassword,
          credentials: await workspaceCreateLogger.step("fetch-model-credentials", () =>
            getUserProviderCredentials(userId, input.modelCredentialIds),
          ),
        });

        if (!agentProvisioning.usesServerPassword) {
          encryptedServerPassword = undefined;
        }

        const provisioningSpec = buildWorkspaceProvisioningSpec({
          agent: agentProvisioning,
          repo: input.repo
            ? {
                url: input.repo,
                branch: input.branch?.trim() || undefined,
                baseCommit: resolvedBaseCommit ?? undefined,
                checkoutRef: resolvedCheckoutRef ?? undefined,
                name: repoInfo?.repo,
                authUsername: githubAppToken ? githubUsername : undefined,
                authToken: githubAppToken,
              }
            : null,
          serverPassword,
          sshPublicKey:
            editorAccessEnabled && providerKey !== "daytona"
              ? normalizeSshPublicKey(fetchedUser.sshPublicKey ?? "")
              : undefined,
          workspaceProfile,
          editorAccessEnabled,
        });

        // Serialize the spec + runtime vars into the env handed to the compute
        // provider. User-defined vars are merged here, with reserved system keys
        // stripped so they cannot clobber WORKSPACE_AUTH_TOKEN and friends.
        const DEFAULT_DOCKER_ENV_VARS = buildWorkspaceEnv(provisioningSpec, {
          githubUsername,
          githubAppToken,
          githubAppTokenExpiry,
          toolingManifestBase64: WORKSPACE_TOOLING_MANIFEST_BASE64,
          repoOwner: repoInfo?.owner,
          workspaceId,
          workspaceAuthToken,
          workspaceApiUrl: WORKSPACE_API_URL,
          workspaceProvider: providerKey,
          userEnv: userWorkspaceEnvironmentVariables
            ? (userWorkspaceEnvironmentVariables.environmentVariables as Record<
                string,
                string | undefined
              >)
            : undefined,
        });

        // Get compute provider
        const computeProvider = await getProviderByCloudProviderId(providerKey);

        // Plan-based persistence gating: free tier cannot opt into persistent
        // (volume-backed) workspaces. Guard server-side even though the UI hides
        // the toggle. Self-hosted and paid plans are allowed.
        //
        // Exception: when the provider is auto-persistent (e.g. E2B), persistence
        // is inherent to the provider and cannot be disabled, so we allow it for
        // every plan. We only block opt-in persistence on providers that don't
        // force it on; otherwise free users couldn't use auto-persistent
        // providers at all.
        if (
          input.persistent &&
          !cloudProviderRecord.autoPersistent &&
          !canCreatePersistentWorkspace(planForGating)
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Persistent workspaces require a Starter or Pro plan. Upgrade to keep your workspace state.",
          });
        }

        // Force ephemeral when the provider can't persist files (e.g. Cloudflare
        // sandboxes). The UI disables the toggle, but guard server-side too.
        const effectivePersistent =
          cloudProviderRecord.supportsPersistence === false ? false : input.persistent;

        // If immediate we send the intial workspace status to running
        const initialWorkspaceStatus =
          cloudProviderRecord.creationSettlement === "immediate" ? "running" : "pending";

        // Create workspace via compute provider
        const workspaceInfo = await workspaceCreateLogger.step(
          `provision-workspace provider=${providerKey} persistent=${effectivePersistent}`,
          () =>
            effectivePersistent
              ? computeProvider.createPersistentWorkspace({
                  workspaceId,
                  userId,
                  imageId: imageRecord.imageId,
                  imageProviderMetadata: imageRecord.providerMetadata,
                  subdomain,
                  repositoryUrl: input.repo,
                  repositoryBranch: input.branch,
                  repositoryBaseCommit: resolvedBaseCommit ?? undefined,
                  repositoryCheckoutRef: resolvedCheckoutRef ?? undefined,
                  regionIdentifier: regionRecord?.externalRegionIdentifier,
                  environmentVariables: DEFAULT_DOCKER_ENV_VARS,
                  provisioningSpec,
                  persistent: effectivePersistent,
                })
              : computeProvider.createWorkspace({
                  workspaceId,
                  userId,
                  imageId: imageRecord.imageId,
                  imageProviderMetadata: imageRecord.providerMetadata,
                  subdomain,
                  repositoryUrl: input.repo,
                  repositoryBranch: input.branch,
                  repositoryBaseCommit: resolvedBaseCommit ?? undefined,
                  repositoryCheckoutRef: resolvedCheckoutRef ?? undefined,
                  regionIdentifier: regionRecord?.externalRegionIdentifier,
                  environmentVariables: DEFAULT_DOCKER_ENV_VARS,
                  provisioningSpec,
                }),
        );

        // SDK providers may have captured the agent's own access credential
        // (e.g. a T3 pairing token); it takes the server password's place.
        if (workspaceInfo.accessCredential) {
          encryptedServerPassword = encryptWorkspacePassword(workspaceInfo.accessCredential);
        }

        // Save workspace to database
        const [newWorkspace] = await db
          .insert(workspace)
          .values({
            id: workspaceId,
            externalInstanceId: workspaceInfo.externalServiceId,
            userId,
            imageId: imageRecord.id,
            cloudProviderId: input.cloudProviderId,
            gitIntegrationId: input.gitIntegrationId ?? null,
            modelCredentialIds: input.modelCredentialIds ?? [],
            persistent: effectivePersistent,
            regionId: regionRecord?.id,
            repositoryUrl: input.repo ?? null,
            repositoryBranch: input.branch ?? null,
            repositoryBaseCommit: resolvedBaseCommit,
            repositoryCheckoutRef: resolvedCheckoutRef,
            domain,
            subdomain,
            serverOnly: agentTypeRecord.serverOnly,
            workspaceProfile,
            editorAccessEnabled,
            editorTarget: null,
            sshConnection: null,
            serverPassword: encryptedServerPassword ?? null,
            upstreamUrl: workspaceInfo.upstreamUrl,
            status: initialWorkspaceStatus,
            hostingType: isLocal ? "local" : "cloud",
            name: input.name || subdomain,
            startedAt: new Date(workspaceInfo.serviceCreatedAt),
            lastActiveAt: new Date(workspaceInfo.serviceCreatedAt),
            updatedAt: new Date(workspaceInfo.serviceCreatedAt),
          })
          .returning();

        if (!newWorkspace) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create workspace record",
          });
        }

        workspaceCreateLogger.log(
          `workspace-record-created provider=${providerKey} persistent=${effectivePersistent}`,
        );

        if (workspaceInfo.upstreamAccess?.headers) {
          await upsertWorkspaceRouteAccess(workspaceId, null, workspaceInfo.upstreamAccess.headers);
        }
        await invalidateWorkspaceCacheAfterMutation(workspaceId, subdomain);

        // Create volume record (only for persistent workspaces)
        let newVolume = null;
        if (effectivePersistent) {
          const persistentInfo = workspaceInfo as PersistentWorkspaceInfo;
          const [volumeRecord] = await db
            .insert(volume)
            .values({
              workspaceId: workspaceId,
              userId: userId,
              cloudProviderId: input.cloudProviderId,
              regionId: regionRecord?.id,
              externalVolumeId: persistentInfo.externalVolumeId,
              mountPath: "/workspace",
              createdAt: new Date(persistentInfo.volumeCreatedAt),
              updatedAt: new Date(persistentInfo.volumeCreatedAt),
            })
            .returning();
          newVolume = volumeRecord;
        }

        // Create usage session for billing (only for remote workspaces)
        if (!isLocal) {
          await createUsageSession(workspaceId, userId);
        }

        // Emit status event
        WORKSPACE_EVENTS.emitStatus({
          workspaceId,
          status: initialWorkspaceStatus,
          updatedAt: new Date(workspaceInfo.serviceCreatedAt),
          userId,
          workspaceDomain: domain,
        });

        sendWorkspaceCreatedNotification({
          domain,
          subdomain,
          workspaceId,
          status: newWorkspace.status,
          hostingType: newWorkspace.hostingType,
          persistent: newWorkspace.persistent,
          serverOnly: newWorkspace.serverOnly,
          userName: fetchedUser.name,
          userEmail: fetchedUser.email,
          agentTypeName: agentTypeRecord.name,
          cloudProviderName: cloudProviderRecord.name,
          regionName: regionRecord?.name || "no-region",
          regionExternalIdentifier: regionRecord?.externalRegionIdentifier || "N/A",
          repoUrl: input.repo,
          serviceCreatedAt: workspaceInfo.serviceCreatedAt,
          upstreamUrl: newWorkspace.upstreamUrl,
        });

        const workspaceForRuntime = {
          ...newWorkspace,
          serverPassword: serverPassword ?? newWorkspace.serverPassword,
        };
        const runtime = buildWorkspaceRuntimeAccess({
          workspace: workspaceForRuntime,
          headers: workspaceInfo.upstreamAccess?.headers ?? null,
          password: serverPassword ?? null,
          providerKey,
        });

        return {
          success: true,
          message: "Workspace created successfully",
          workspace: newWorkspace,
          volume: newVolume,
          runtime,
        };
      } catch (error) {
        console.error("createWorkspace failed:", error);
        // Throw a user-friendly error to the client
        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create workspace. Please try again later.",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  getRuntimeAccess: protectedProcedure
    .input(z.object({ workspaceId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const workspaceRecord = await db.query.workspace.findFirst({
        where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
      });

      if (!workspaceRecord) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const [provider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, workspaceRecord.cloudProviderId));

      let password: string | null = null;
      if (workspaceRecord.serverPassword && workspaceRecord.serverOnly) {
        try {
          password = decryptWorkspacePassword(workspaceRecord.serverPassword);
        } catch (error) {
          console.error(`Failed to decrypt password for workspace ${workspaceRecord.id}:`, error);
        }
      }

      const headers = await getWorkspaceRouteAccess(workspaceRecord.id, null);

      return buildWorkspaceRuntimeAccess({
        workspace: workspaceRecord,
        headers,
        password,
        providerKey: provider?.providerKey ?? null,
      });
    }),

  ensureRunning: protectedProcedure
    .input(
      z.object({
        workspaceId: z.uuid(),
        /** Max time to wait for runtime URL after restart (ms). */
        timeoutMs: z.number().int().min(1_000).max(300_000).default(120_000).optional(),
        /** Poll interval while waiting for running status (ms). */
        pollIntervalMs: z.number().int().min(250).max(10_000).default(2_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const timeoutMs = input.timeoutMs ?? 120_000;
      const pollIntervalMs = input.pollIntervalMs ?? 2_000;

      const loadOwnedWorkspace = async () => {
        const [row] = await db
          .select()
          .from(workspace)
          .where(and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)));
        return row ?? null;
      };

      let existingWorkspace = await loadOwnedWorkspace();
      if (!existingWorkspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      if (existingWorkspace.status === "terminated") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Workspace is terminated and cannot be restarted",
        });
      }

      if (isResumableWorkspaceStatus(existingWorkspace.status)) {
        const hasQuota = await hasRemainingQuota(userId);
        if (!hasQuota) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Daily free tier limit reached. Please try again tomorrow.",
          });
        }

        const [provider] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.id, existingWorkspace.cloudProviderId));

        if (!provider) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Cloud provider not found",
          });
        }

        let workspaceRegion;
        if (provider.supportsRegions && existingWorkspace.regionId) {
          [workspaceRegion] = await db
            .select()
            .from(region)
            .where(eq(region.id, existingWorkspace.regionId));
        }

        const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
        await computeProvider.restartWorkspace(
          existingWorkspace.externalInstanceId,
          workspaceRegion?.externalRegionIdentifier,
          existingWorkspace.externalRunningDeploymentId ?? undefined,
        );

        const restartWorkspaceStatus =
          provider.restartSettlement === "immediate" ? "running" : "pending";
        const now = new Date();
        await updateWorkspaceByIdAndInvalidate(
          input.workspaceId,
          {
            status: restartWorkspaceStatus,
            stoppedAt: null,
            lastActiveAt: now,
            updatedAt: now,
          },
          existingWorkspace.subdomain,
        );

        await createUsageSession(input.workspaceId, userId);

        WORKSPACE_EVENTS.emitStatus({
          workspaceId: input.workspaceId,
          status: restartWorkspaceStatus,
          updatedAt: now,
          userId,
          workspaceDomain: existingWorkspace.domain,
        });

        existingWorkspace = (await loadOwnedWorkspace()) ?? existingWorkspace;
      }

      // Wait until running (or timeout) when still pending after restart/create.
      if (existingWorkspace.status === "pending" || existingWorkspace.status === "running") {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          existingWorkspace = (await loadOwnedWorkspace()) ?? existingWorkspace;
          if (existingWorkspace.status === "running" && existingWorkspace.subdomain) {
            break;
          }
          if (existingWorkspace.status === "terminated") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Workspace terminated while waiting to become running",
            });
          }
          if (existingWorkspace.status === "running") break;
          if (existingWorkspace.status !== "pending") break;
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      }

      existingWorkspace = (await loadOwnedWorkspace()) ?? existingWorkspace;
      if (!existingWorkspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      if (existingWorkspace.status !== "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Workspace is ${existingWorkspace.status}; runtime is not available yet`,
        });
      }

      const [provider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, existingWorkspace.cloudProviderId));

      let password: string | null = null;
      if (existingWorkspace.serverPassword && existingWorkspace.serverOnly) {
        try {
          password = decryptWorkspacePassword(existingWorkspace.serverPassword);
        } catch (error) {
          console.error(`Failed to decrypt password for workspace ${existingWorkspace.id}:`, error);
        }
      }

      const headers = await getWorkspaceRouteAccess(existingWorkspace.id, null);
      const runtime = buildWorkspaceRuntimeAccess({
        workspace: existingWorkspace,
        headers,
        password,
        providerKey: provider?.providerKey ?? null,
      });

      return {
        success: true,
        workspace: existingWorkspace,
        runtime,
      };
    }),

  // Pause a running workspace (compute down, recoverable)
  pauseWorkspace: protectedProcedure
    .input(
      z.object({
        workspaceId: z.uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      try {
        // Verify workspace belongs to user
        const [existingWorkspace] = await db
          .select()
          .from(workspace)
          .where(and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)));

        if (!existingWorkspace) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workspace not found",
          });
        }

        if (existingWorkspace.status !== "running") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Workspace is not running",
          });
        }

        // Get the cloud provider name
        const [provider] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.id, existingWorkspace.cloudProviderId));

        if (!provider) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Cloud provider not found",
          });
        }

        let workspaceRegion;
        if (provider.supportsRegions && existingWorkspace.regionId) {
          // Get the region identifier
          [workspaceRegion] = await db
            .select()
            .from(region)
            .where(eq(region.id, existingWorkspace.regionId));

          if (!workspaceRegion) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Region not found",
            });
          }
        }

        // Get compute provider and stop the workspace
        const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
        if (existingWorkspace.sshConnection) {
          await computeProvider
            .revokeWorkspaceSSHAccess({
              workspaceId: existingWorkspace.id,
              externalServiceId: existingWorkspace.externalInstanceId,
              connection: existingWorkspace.sshConnection,
              regionIdentifier: workspaceRegion?.externalRegionIdentifier,
            })
            .catch((error) => {
              console.warn("Failed to revoke workspace editor access during stop:", error);
            });
        }

        await computeProvider.stopWorkspace(
          existingWorkspace.externalInstanceId,
          workspaceRegion?.externalRegionIdentifier,
          existingWorkspace.externalRunningDeploymentId ?? undefined,
        );

        // Close the usage session
        const { durationMinutes } = await closeUsageSession(input.workspaceId, "manual");

        // Update workspace status
        const now = new Date();
        await updateWorkspaceByIdAndInvalidate(
          input.workspaceId,
          {
            status: "paused",
            stoppedAt: now,
            sshConnection: null,
            updatedAt: now,
          },
          existingWorkspace.subdomain,
        );

        // Emit status event
        WORKSPACE_EVENTS.emitStatus({
          workspaceId: input.workspaceId,
          status: "paused",
          updatedAt: now,
          userId,
          workspaceDomain: existingWorkspace.domain,
        });

        return {
          success: true,
          message: "Workspace paused successfully",
          durationMinutes,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to pause workspace",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Restart a paused workspace
  restartWorkspace: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      try {
        // Check quota first
        const hasQuota = await hasRemainingQuota(userId);
        if (!hasQuota) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Daily free tier limit reached. Please try again tomorrow.",
          });
        }

        // Verify workspace belongs to user
        const [existingWorkspace] = await db
          .select()
          .from(workspace)
          .where(and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)));

        if (!existingWorkspace) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workspace not found",
          });
        }

        if (existingWorkspace.status !== "paused") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Workspace is not paused",
          });
        }

        // Get the cloud provider name
        const [provider] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.id, existingWorkspace.cloudProviderId));

        if (!provider) {
          console.error("Cloud provider not found for workspace:", existingWorkspace.id);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Cloud provider not found",
          });
        }

        let workspaceRegion;
        if (provider.supportsRegions && existingWorkspace.regionId) {
          // Get the region identifier
          [workspaceRegion] = await db
            .select()
            .from(region)
            .where(eq(region.id, existingWorkspace.regionId));

          if (!workspaceRegion) {
            console.error("Region not found for workspace:", existingWorkspace.id);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Region not found",
            });
          }
        }

        // Get compute provider and restart the workspace
        const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
        await computeProvider.restartWorkspace(
          existingWorkspace.externalInstanceId,
          workspaceRegion?.externalRegionIdentifier,
          existingWorkspace.externalRunningDeploymentId ?? undefined,
        );

        const restartWorkspaceStatus =
          provider.restartSettlement === "immediate" ? "running" : "pending";
        // Update workspace status
        const now = new Date();
        await updateWorkspaceByIdAndInvalidate(
          input.workspaceId,
          {
            status: restartWorkspaceStatus,
            stoppedAt: null,
            lastActiveAt: now,
            updatedAt: now,
          },
          existingWorkspace.subdomain,
        );

        await createUsageSession(input.workspaceId, userId);

        // Emit status event
        WORKSPACE_EVENTS.emitStatus({
          workspaceId: input.workspaceId,
          status: restartWorkspaceStatus,
          updatedAt: now,
          userId,
          workspaceDomain: existingWorkspace.domain,
        });

        return {
          success: true,
          message:
            restartWorkspaceStatus === "running"
              ? "Workspace restarted successfully"
              : "Workspace restarting",
          status: restartWorkspaceStatus,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Failed to restart workspace:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to restart workspace",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Delete a workspace
  deleteWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const fetchedWorkspace = await db.query.workspace.findFirst({
        where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
        with: {
          volume: true,
        },
      });

      if (!fetchedWorkspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      // Close usage session if workspace was running
      if (fetchedWorkspace.status === "running" || fetchedWorkspace.status === "pending") {
        await closeUsageSession(input.workspaceId, "manual");
      }

      // Get the cloud provider name
      const [provider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, fetchedWorkspace.cloudProviderId));

      if (!provider) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Cloud provider not found",
        });
      }

      // Get compute provider and terminate the workspace
      const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
      const terminateInBackground = provider.providerKey === "aws";
      const externalVolumeId = fetchedWorkspace.persistent
        ? fetchedWorkspace.volume.externalVolumeId
        : undefined;
      const terminatedAt = new Date();

      const runTerminationCleanup = async () => {
        if (fetchedWorkspace.sshConnection) {
          await computeProvider
            .revokeWorkspaceSSHAccess({
              workspaceId: fetchedWorkspace.id,
              externalServiceId: fetchedWorkspace.externalInstanceId,
              connection: fetchedWorkspace.sshConnection,
            })
            .catch((error) => {
              console.warn("Failed to revoke workspace editor access during delete:", error);
            });
        }

        for (const exposedPort of Object.values(fetchedWorkspace.exposedPorts ?? {})) {
          if (exposedPort?.externalPortDomainId) {
            await computeProvider.removeExposedPortDomain(exposedPort.externalPortDomainId);
          }
        }

        await computeProvider.terminateWorkspace(
          fetchedWorkspace.externalInstanceId,
          externalVolumeId,
        );

        await updateWorkspaceRoutingAndInvalidate(
          fetchedWorkspace.id,
          {
            externalInstanceId: "",
            externalRunningDeploymentId: null,
            upstreamUrl: null,
            exposedPorts: null,
            updatedAt: new Date(),
          },
          fetchedWorkspace.subdomain,
        );
      };

      if (!terminateInBackground) {
        await runTerminationCleanup();
      }

      const [updatedWorkspace] = await updateWorkspaceByIdReturningAndInvalidate(
        input.workspaceId,
        {
          status: "terminated",
          stoppedAt: terminatedAt,
          terminatedAt,
          exposedPorts: null,
          sshConnection: null,
          updatedAt: terminatedAt,
        },
      );

      await deleteAllWorkspaceRouteAccess(input.workspaceId);

      // Delete volume record
      if (fetchedWorkspace.persistent) {
        await db.delete(volume).where(eq(volume.id, fetchedWorkspace.volume.id));
      }

      // Emit status event
      WORKSPACE_EVENTS.emitStatus({
        workspaceId: input.workspaceId,
        status: "terminated",
        updatedAt: terminatedAt,
        userId,
        workspaceDomain: fetchedWorkspace.domain,
      });

      if (terminateInBackground) {
        void runTerminationCleanup().catch((error) => {
          console.error(
            `Failed to finish background termination for workspace ${fetchedWorkspace.id}:`,
            error,
          );
        });
      }

      return {
        workspace: updatedWorkspace,
        success: true,
        cleanupInBackground: terminateInBackground,
      };
    }),

  openWorkspacePort: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        port: z.number(),
        name: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const fetchedWorkspace = await db.query.workspace.findFirst({
        where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
      });

      if (!fetchedWorkspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const [provider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, fetchedWorkspace.cloudProviderId));

      if (!provider) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Cloud provider not found",
        });
      }

      const computeProvider = await getProviderByCloudProviderId(provider.providerKey);

      const { domain, externalPortDomainId, upstreamAccess } =
        await computeProvider.createOrGetExposedPortDomain(
          fetchedWorkspace.externalInstanceId,
          input.port,
        );

      await updateWorkspaceRoutingAndInvalidate(
        input.workspaceId,
        {
          exposedPorts: {
            ...fetchedWorkspace.exposedPorts,
            [input.port]: {
              port: input.port,
              name: input.name,
              upstreamUrl: domain,
              externalPortDomainId,
            },
          },
        },
        fetchedWorkspace.subdomain,
      );

      if (upstreamAccess?.headers) {
        await upsertWorkspaceRouteAccess(input.workspaceId, input.port, upstreamAccess.headers);
      } else {
        await deleteWorkspaceRouteAccess(input.workspaceId, input.port);
      }

      return {
        success: true,
        message: "Workspace port opened successfully",
      };
    }),

  closeWorkspacePort: protectedProcedure
    .input(z.object({ workspaceId: z.string(), port: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const fetchedWorkspace = await db.query.workspace.findFirst({
        where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
      });

      if (!fetchedWorkspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const externalPortDomainId =
        fetchedWorkspace.exposedPorts?.[input.port]?.externalPortDomainId;
      if (externalPortDomainId) {
        const [provider] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.id, fetchedWorkspace.cloudProviderId));

        if (!provider) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Cloud provider not found",
          });
        }

        const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
        await computeProvider.removeExposedPortDomain(externalPortDomainId);
      }

      await updateWorkspaceRoutingAndInvalidate(
        input.workspaceId,
        {
          exposedPorts: {
            ...fetchedWorkspace.exposedPorts,
            [input.port]: undefined,
          },
        },
        fetchedWorkspace.subdomain,
      );

      await deleteWorkspaceRouteAccess(input.workspaceId, input.port);

      return {
        success: true,
        message: "Workspace port closed successfully",
      };
    }),
});
