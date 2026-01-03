import { randomUUID } from "crypto";
import z from "zod";
import { protectedProcedure, workspaceAuthProcedure, router } from "../../index";
import { db, eq, and, asc, or } from "@gitterm/db";
import {
  agentWorkspaceConfig,
  workspaceEnvironmentVariables,
  workspace,
  volume,
} from "@gitterm/db/schema/workspace";
import { agentType, image, cloudProvider, region } from "@gitterm/db/schema/cloud";
import { user } from "@gitterm/db/schema/auth";
import { TRPCError } from "@trpc/server";
import { validateAgentConfig } from "@gitterm/schema";
import {
  getOrCreateDailyUsage,
  hasRemainingQuota,
  updateLastActive,
  closeUsageSession,
  createUsageSession,
  FREE_TIER_DAILY_MINUTES,
} from "../../utils/metering";
import { getProviderByCloudProviderId, type PersistentWorkspaceInfo, type WorkspaceInfo } from "../../providers";
import { WORKSPACE_EVENTS } from "../../events/workspace";
import { getGitHubAppService } from "../../service/github";
import { workspaceJWT } from "../../service/workspace-jwt";
import { githubAppInstallation, gitIntegration } from "@gitterm/db/schema/integrations";
import { sendAdminMessage } from "../../utils/discord";
import { getWorkspaceDomain } from "../../utils/routing";
import { canUseCustomSubdomain, type UserPlan } from "../../config/features";

// Reserved subdomains that cannot be used by users
const RESERVED_SUBDOMAINS = [
  'api',
  'tunnel',
  'www',
  'app',
  'admin',
  'dashboard',
  'cdn',
  'static',
  'assets',
  'mail',
  'email',
  'ftp',
  'ssh',
  'docs',
  'blog',
  'status',
  'support',
];

function isSubdomainReserved(subdomain: string): boolean {
  return RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase());
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
        eq(gitIntegration.providerInstallationId, githubAppInstallation.installationId)
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
      canUseCustomSubdomain: canUseCustomSubdomain(userPlan as UserPlan),
      userPlan,
    };
  }),

  // List all agent types
  listAgentTypes: protectedProcedure.query(async () => {
    try {
      const types = await db
        .select()
        .from(agentType)
        .where(eq(agentType.isEnabled, true));
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
          .where(and(
            eq(image.agentTypeId, input.agentTypeId),
            eq(image.isEnabled, true)
          ));
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
  listCloudProviders: protectedProcedure.query(async () => {
    try {
      const providers = await db.query.cloudProvider.findMany({
        where: eq(cloudProvider.isEnabled, true),
        with: {
          regions: {
            where: eq(region.isEnabled, true),
          },
        },
        orderBy: [asc(cloudProvider.name)],
      });
      
      return {
        success: true,
        cloudProviders: providers,
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
      z.object({
        limit: z.number().min(1).max(100).default(12),
        offset: z.number().min(0).default(0),
        status: z.enum(["all", "active", "terminated"]).default("active"),
      }).optional()
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
        const statusCondition = status === "all" 
          ? eq(workspace.userId, userId)
          : status === "terminated"
            ? and(eq(workspace.userId, userId), eq(workspace.status, "terminated"))
            : and(
                eq(workspace.userId, userId),
                or(
                  eq(workspace.status, "running"),
                  eq(workspace.status, "pending"),
                  eq(workspace.status, "stopped")
                )
              );

        // Get total count for pagination
        const [countResult] = await db
          .select({ count: workspace.id })
          .from(workspace)
          .where(statusCondition);
        
        // Count actual rows (drizzle returns undefined for count on empty)
        const totalWorkspaces = await db
          .select({ id: workspace.id })
          .from(workspace)
          .where(statusCondition);
        const total = totalWorkspaces.length;

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
          orderBy: (workspace, { desc }) => [desc(workspace.startedAt)],
          limit,
          offset,
        });

        return {
          success: true,
          workspaces,
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

  // Create or update workspace configuration
  createConfig: protectedProcedure
    .input(
      z.object({
        agentTypeId: z.string().min(1, "Agent type ID is required"),
        config: z.record(z.string(), z.any()).refine(
          (obj) => Object.keys(obj).length > 0,
          { message: "Config cannot be empty" }
        ),
      })
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
        // Validate config against the agent-specific schema
        const validationResult = validateAgentConfig(
          input.agentTypeId,
          input.config
        );

        if (!validationResult.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid configuration format",
            cause: validationResult.error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; "),
          });
        }

        // Check if config already exists for this user and agent type
        const existingConfigs = await db
          .select()
          .from(agentWorkspaceConfig)
          .where(
            and(
              eq(agentWorkspaceConfig.userId, userId),
              eq(agentWorkspaceConfig.agentTypeId, input.agentTypeId)
            )
          );

        if (existingConfigs.length > 0) {
          // Update existing config
          const [updatedConfig] = await db
            .update(agentWorkspaceConfig)
            .set({
              config: validationResult.data,
              updatedAt: new Date(),
            })
            .where(eq(agentWorkspaceConfig.id, existingConfigs[0]!.id))
            .returning();

          return {
            success: true,
            message: "Configuration updated successfully",
            config: updatedConfig,
          };
        } else {
          // Create new config
          const [newConfig] = await db
            .insert(agentWorkspaceConfig)
            .values({
              userId,
              agentTypeId: input.agentTypeId,
              config: validationResult.data,
            })
            .returning();

          return {
            success: true,
            message: "Configuration created successfully",
            config: newConfig,
          };
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create or update configuration",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Get workspace configuration for a specific agent type
  getConfig: protectedProcedure
    .input(
      z.object({
        agentTypeId: z.string().min(1, "Agent type ID is required"),
      })
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
        const configs = await db
          .select()
          .from(agentWorkspaceConfig)
          .where(
            and(
              eq(agentWorkspaceConfig.userId, userId),
              eq(agentWorkspaceConfig.agentTypeId, input.agentTypeId)
            )
          );

        if (configs.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Configuration not found for this agent type",
          });
        }

        return {
          success: true,
          config: configs[0]!,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch configuration",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // List all configurations for the authenticated user
  listConfigs: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    try {
      const configs = await db
        .select()
        .from(agentWorkspaceConfig)
        .where(eq(agentWorkspaceConfig.userId, userId));

      return {
        success: true,
        configs,
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch configurations",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  // Delete workspace configuration
  deleteConfig: protectedProcedure
    .input(
      z.object({
        agentTypeId: z.string().min(1, "Agent type ID is required"),
      })
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
        const configs = await db
          .select()
          .from(agentWorkspaceConfig)
          .where(
            and(
              eq(agentWorkspaceConfig.userId, userId),
              eq(agentWorkspaceConfig.agentTypeId, input.agentTypeId)
            )
          );

        if (configs.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Configuration not found",
          });
        }

        await db
          .delete(agentWorkspaceConfig)
          .where(eq(agentWorkspaceConfig.id, configs[0]!.id));

        return {
          success: true,
          message: "Configuration deleted successfully",
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete configuration",
          cause: error instanceof Error ? error.message : "Unknown error",
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
          .refine(
            (obj) => Object.keys(obj).length > 0,
            { message: "Environment variables cannot be empty" }
          ),
      })
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
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId)
            )
          );

        if (existingVars.length > 0) {
          // Update existing environment variables
          const [updatedVars] = await db
            .update(workspaceEnvironmentVariables)
            .set({
              environmentVariables: input.environmentVariables,
              updatedAt: new Date(),
            })
            .where(
              eq(workspaceEnvironmentVariables.id, existingVars[0]!.id)
            )
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
      })
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
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId)
            )
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
      })
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
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId)
            )
          );

        if (vars.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Environment variables not found",
          });
        }

        await db
          .delete(workspaceEnvironmentVariables)
          .where(
            eq(workspaceEnvironmentVariables.id, vars[0]!.id)
          );

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
      })
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
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId)
            )
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
      const usage = await getOrCreateDailyUsage(userId);
      return {
        success: true,
        minutesUsed: usage.minutesUsed,
        minutesRemaining: usage.minutesRemaining,
        dailyLimit: FREE_TIER_DAILY_MINUTES,
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
      const canStart = await hasRemainingQuota(userId);
      const usage = await getOrCreateDailyUsage(userId);
      
      return {
        success: true,
        canStartWorkspace: canStart,
        minutesRemaining: usage.minutesRemaining,
        dailyLimit: FREE_TIER_DAILY_MINUTES,
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
        workspaceId: z.string().uuid(),
        timestamp: z.number().optional(),
        cpu: z.number().optional(),
        active: z.boolean().optional(),
      })
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
        subdomain: z.union([
          z.string().min(1).max(63).regex(/^[a-z0-9-]+$/),
          z.literal("")
        ]).optional(),        
        agentTypeId: z.string(),
        cloudProviderId: z.string(),
        regionId: z.string(),
        gitInstallationId: z.string().optional(),
        persistent: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const workspaceId = randomUUID();

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const [fetchedUser] = await db.select().from(user).where(eq(user.id, userId));

      if (!fetchedUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // if (fetchedUser && !fetchedUser.allowTrial) 
      //   throw new TRPCError({ code: "FORBIDDEN", message: "Reachout for Access" });

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

        // Determine if this is a local workspace
        const isLocal = cloudProviderRecord.name.toLowerCase() === "local";

        // Check quota only for cloud workspaces (local doesn't use our resources)
        if (!isLocal) {
          const hasQuota = await hasRemainingQuota(userId);
          if (!hasQuota) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Daily free tier limit reached. Please try again tomorrow.",
            });
          }
        }

        const runningWorkspaces = await db.select().from(workspace).where(and(eq(workspace.userId, userId), or(eq(workspace.status, "running"), eq(workspace.status, "pending"), eq(workspace.status, "stopped"))));

        if (fetchedUser.email !== "brightoginni123@gmail.com" && runningWorkspaces.length >= 1) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You have reached the maximum number of workspaces. Please upgrade to a paid plan or delete some workspaces.",
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
        const [regionRecord] = await db
          .select()
          .from(region)
          .where(
            and(
              eq(region.id, input.regionId),
              eq(region.cloudProviderId, input.cloudProviderId)
            )
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

        // Get image for this agent type (take the first one)
        const [imageRecord] = await db
          .select()
          .from(image)
          .where(and(
            eq(image.agentTypeId, input.agentTypeId),
            eq(image.isEnabled, true)
          ));

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

        if (!imageRecord) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No enabled image found for this agent type",
          });
        }

        // Fetch user's agent configuration
        const [agentConfig] = await db
          .select()
          .from(agentWorkspaceConfig)
          .where(
            and(
              eq(agentWorkspaceConfig.userId, userId),
              eq(agentWorkspaceConfig.agentTypeId, input.agentTypeId)
            )
          );

        // Fetch user's workspace environment variables
        const [userWorkspaceEnvironmentVariables] = await db
          .select()
          .from(workspaceEnvironmentVariables)
          .where(
            and(
              eq(workspaceEnvironmentVariables.userId, userId),
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId)
            )
          );

        // Get GitHub username from user.name (set during OAuth)
        const [userRecord] = await db
          .select()
          .from(user)
          .where(eq(user.id, userId));

        const githubUsername = userRecord?.name;

        // Get GitHub App installation and generate token
        let githubAppToken: string | undefined;
        let githubAppTokenExpiry: string | undefined;

        if (input.gitInstallationId) {
          const [gitIntegrationRecord] = await db.select().from(gitIntegration).where(and(eq(gitIntegration.id, input.gitInstallationId), eq(gitIntegration.userId, userId)));

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

        const installation = await getGitHubAppService().getUserInstallation(userId, gitIntegrationRecord.providerInstallationId);
        if (installation && !installation.suspended) {
          try {
              const tokenData = await getGitHubAppService().getUserToServerToken(installation.installationId);
              githubAppToken = tokenData.token;
              githubAppTokenExpiry = tokenData.expiresAt;
            } catch (error) {
              console.error("Failed to generate GitHub App token:", error);
              // Continue without token - user can still use workspace without git operations
            }
          }
        }

        // Parse repo URL to get owner/name (only for cloud workspaces)
        const repoInfo = input.repo ? getGitHubAppService().parseRepoUrl(input.repo) : null;

        // Generate or validate subdomain
        let subdomain: string;
        const userPlan = (fetchedUser.plan || 'free') as UserPlan;
        
        if (input.subdomain) {
          // User wants a custom subdomain
          
          // Check if subdomain is reserved
          if (isSubdomainReserved(input.subdomain)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Subdomain '${input.subdomain}' is reserved and cannot be used`,
            });
          }
          
          // Check plan-based permissions for custom subdomains
          // Note: canUseCustomSubdomain already returns true for self-hosted
          if (!canUseCustomSubdomain(userPlan)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Custom subdomains require a Tunnel or Pro plan.",
            });
          }
          
          // Check uniqueness - only among running/pending workspaces
          const [existing] = await db
            .select()
            .from(workspace)
            .where(and(eq(workspace.subdomain, input.subdomain), or(eq(workspace.status, "running"), eq(workspace.status, "pending"))))
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
          let attempts = 0;
          do {
            if (attempts > 10) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to generate unique subdomain",
              });
            }
            subdomain = `ws-${randomUUID().split('-')[0]}`;
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
          ['git:*', 'git:fork', 'git:refresh'] // All git scopes
        );

        // API endpoint for workspace operations
        const WORKSPACE_API_URL = process.env.WORKSPACE_API_URL || process.env.INTERNAL_API_URL || "https://api.gitterm.dev/trpc";

        // Generate domain using routing utils
        // In path mode: returns just subdomain (stored for lookup)
        // In subdomain mode: returns subdomain.baseDomain
        const domain = getWorkspaceDomain(subdomain);

        const DEFAULT_DOCKER_ENV_VARS = {
          "REPO_URL": input.repo || undefined,
          "OPENCODE_CONFIG_BASE64": agentConfig ? Buffer.from(JSON.stringify(agentConfig.config)).toString("base64") : undefined,
          "USER_GITHUB_USERNAME": githubUsername,
          "GITHUB_APP_TOKEN": githubAppToken,
          "GITHUB_APP_TOKEN_EXPIRY": githubAppTokenExpiry,
          "REPO_OWNER": repoInfo?.owner,
          "REPO_NAME": repoInfo?.repo,
          "WORKSPACE_ID": workspaceId,
          "WORKSPACE_AUTH_TOKEN": workspaceAuthToken, // JWT instead of shared key
          "WORKSPACE_API_URL": WORKSPACE_API_URL,
          ...(userWorkspaceEnvironmentVariables ? userWorkspaceEnvironmentVariables.environmentVariables as any : {}),
        };

        // Get compute provider
        const computeProvider = await getProviderByCloudProviderId(cloudProviderRecord.name);

        // Create workspace via compute provider
        const workspaceInfo = input.persistent
          ? await computeProvider.createPersistentWorkspace({
              workspaceId,
              userId,
              imageId: imageRecord.imageId,
              subdomain,
              repositoryUrl: input.repo,
              regionIdentifier: regionRecord.externalRegionIdentifier,
              environmentVariables: DEFAULT_DOCKER_ENV_VARS,
              persistent: input.persistent,
            })
          : await computeProvider.createWorkspace({
              workspaceId,
              userId,
              imageId: imageRecord.imageId,
              subdomain,
              repositoryUrl: input.repo,
              regionIdentifier: regionRecord.externalRegionIdentifier,
              environmentVariables: DEFAULT_DOCKER_ENV_VARS,
            });

        // Save workspace to database
        const [newWorkspace] = await db
          .insert(workspace)
          .values({
            id: workspaceId,
            externalInstanceId: workspaceInfo.externalServiceId,
            userId,
            imageId: imageRecord.id,
            cloudProviderId: input.cloudProviderId,
            gitIntegrationId: input.gitInstallationId || null,
            persistent: input.persistent,
            regionId: input.regionId,
            repositoryUrl: input.repo || null,
            domain,
            subdomain,
            serverOnly: agentTypeRecord.serverOnly,
            backendUrl: workspaceInfo.backendUrl,
            status: "pending",
            tunnelType: isLocal ? "local" : "cloud",
            tunnelName: input.name || subdomain,
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

        // Create volume record (only for persistent workspaces)
        let newVolume = null;
        if (input.persistent) {
          const persistentInfo = workspaceInfo as PersistentWorkspaceInfo;
          const [volumeRecord] = await db.insert(volume).values({
            workspaceId: workspaceId,
            userId: userId,
            cloudProviderId: input.cloudProviderId,
            regionId: input.regionId,
            externalVolumeId: persistentInfo.externalVolumeId,
            mountPath: "/workspace",
            createdAt: new Date(persistentInfo.volumeCreatedAt),
            updatedAt: new Date(persistentInfo.volumeCreatedAt),
          }).returning();
          newVolume = volumeRecord;
        }

        // Create usage session for billing (only for cloud workspaces)
        if (!isLocal) {
          await createUsageSession(workspaceId, userId);
        }

        // Emit status event
        WORKSPACE_EVENTS.emitStatus({
          workspaceId,
          status: "pending",
          updatedAt: new Date(workspaceInfo.serviceCreatedAt),
          userId,
          workspaceDomain: domain,
        });

        // For local workspaces, generate connection command
        let command: string | undefined;
        if (isLocal) {
          // The agent CLI will use getTunnelUrl() to determine the correct tunnel endpoint
          command = `npx @opeoginni/gitterm-agent connect --workspace-id ${workspaceId}`;
        }

        // Format Discord notification with all workspace details
        const workspaceDetails = [
          `🚀 **New Workspace Created**`,
          ``,
          `**Workspace Info:**`,
          `• Domain: \`${domain}\``,
          `• Subdomain: \`${subdomain}\``,
          `• Workspace ID: \`${workspaceId}\``,
          `• Status: \`${newWorkspace.status}\``,
          `• Tunnel Type: \`${newWorkspace.tunnelType}\``,
          `• Persistent: ${newWorkspace.persistent ? '✅ Yes' : '❌ No'}`,
          `• Server Only: ${newWorkspace.serverOnly ? '✅ Yes' : '❌ No'}`,
          ``,
          `**User Info:**`,
          `• Name: \`${fetchedUser.name || 'N/A'}\``,
          `• Email: \`${fetchedUser.email}\``,
          `• User ID: \`${userId}\``,
          ``,
          `**Configuration:**`,
          `• Agent Type: \`${agentTypeRecord.name}\``,
          `• Cloud Provider: \`${cloudProviderRecord.name}\``,
          `• Region: \`${regionRecord.name} (${regionRecord.externalRegionIdentifier})\``,
          ``,
        ];

        if (input.repo) {
          workspaceDetails.push(`**Repository:**`, `• URL: \`${input.repo}\``, ``);
        }

        workspaceDetails.push(
          `**Timestamps:**`,
          `• Created: \`${new Date(workspaceInfo.serviceCreatedAt).toISOString()}\``,
          `• Backend URL: \`${newWorkspace.backendUrl || 'N/A'}\``
        );

        sendAdminMessage(workspaceDetails.join('\n'));

        return {
          success: true,
          message: "Workspace created successfully",
          workspace: newWorkspace,
          volume: newVolume,
          command, // Only set for local workspaces
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

  // Stop a running workspace
  stopWorkspace: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      try {
        // Verify workspace belongs to user
        const [existingWorkspace] = await db
          .select()
          .from(workspace)
          .where(
            and(
              eq(workspace.id, input.workspaceId),
              eq(workspace.userId, userId)
            )
          );

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

        // Get the region identifier
        const [workspaceRegion] = await db
          .select()
          .from(region)
          .where(eq(region.id, existingWorkspace.regionId));

        if (!workspaceRegion) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Region not found",
          });
        }

        // Get compute provider and stop the workspace
        const computeProvider = await getProviderByCloudProviderId(provider.name);
        await computeProvider.stopWorkspace(
          existingWorkspace.externalInstanceId,
          workspaceRegion.externalRegionIdentifier,
          existingWorkspace.externalRunningDeploymentId ?? undefined
        );

        // Close the usage session
        const { durationMinutes } = await closeUsageSession(input.workspaceId, "manual");

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
          userId,
          workspaceDomain: existingWorkspace.domain,
        });

        return {
          success: true,
          message: "Workspace stopped successfully",
          durationMinutes,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to stop workspace",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Restart a stopped workspace
  restartWorkspace: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
      })
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
          .where(
            and(
              eq(workspace.id, input.workspaceId),
              eq(workspace.userId, userId)
            )
          );

        if (!existingWorkspace) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workspace not found",
          });
        }

        if (existingWorkspace.status !== "stopped") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Workspace is not stopped",
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

        // Get the region identifier
        const [workspaceRegion] = await db
          .select()
          .from(region)
          .where(eq(region.id, existingWorkspace.regionId));

        if (!workspaceRegion) {
          console.error("Region not found for workspace:", existingWorkspace.id);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Region not found" });
        }

        // Get compute provider and restart the workspace
        const computeProvider = await getProviderByCloudProviderId(provider.name);
        await computeProvider.restartWorkspace(
          existingWorkspace.externalInstanceId,
          workspaceRegion.externalRegionIdentifier,
          existingWorkspace.externalRunningDeploymentId ?? undefined
        );

        // Update workspace status
        const now = new Date();
        await db
          .update(workspace)
          .set({
            status: "pending",
            stoppedAt: null,
            lastActiveAt: now,
            updatedAt: now,
          })
          .where(eq(workspace.id, input.workspaceId));

        // Emit status event
        WORKSPACE_EVENTS.emitStatus({
          workspaceId: input.workspaceId,
          status: "pending",
          updatedAt: now,
          userId,
          workspaceDomain: existingWorkspace.domain,
        });

        return {
          success: true,
          message: "Workspace restarting",
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
        }
      });

      if (!fetchedWorkspace) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
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
      const computeProvider = await getProviderByCloudProviderId(provider.name);
      await computeProvider.terminateWorkspace(fetchedWorkspace.externalInstanceId, fetchedWorkspace.persistent ? fetchedWorkspace.volume.externalVolumeId : undefined);

      // Update workspace status
      const [updatedWorkspace] = await db.update(workspace).set({
        status: "terminated",
        stoppedAt: new Date(),
        terminatedAt: new Date(),
        updatedAt: new Date()
      }).where(eq(workspace.id, input.workspaceId)).returning();

      // Delete volume record
      if (fetchedWorkspace.persistent) {
        await db.delete(volume).where(eq(volume.id, fetchedWorkspace.volume.id));
      }

      // Emit status event
      WORKSPACE_EVENTS.emitStatus({
        workspaceId: input.workspaceId,
        status: "terminated",
        updatedAt: new Date(),
        userId,
        workspaceDomain: fetchedWorkspace.domain,
      });

      return {
        workspace: updatedWorkspace,
        success: true,
      };
    }),
});

