import { randomUUID } from "crypto";
import z from "zod";
import { protectedProcedure, publicProcedure, workspaceAuthProcedure, router } from "../index";
import { db, eq, and, asc } from "@gitpad/db";
import {
  agentWorkspaceConfig,
  workspaceEnvironmentVariables,
  workspace,
  volume,
} from "@gitpad/db/schema/workspace";
import { agentType, image, cloudProvider, region } from "@gitpad/db/schema/cloud";
import { user } from "@gitpad/db/schema/auth";
import { TRPCError } from "@trpc/server";
import { validateAgentConfig } from "@gitpad/schema";
import {
  getOrCreateDailyUsage,
  hasRemainingQuota,
  updateLastActive,
  closeUsageSession,
  createUsageSession,
  FREE_TIER_DAILY_MINUTES,
} from "../utils/metering";
import { getProviderByCloudProviderId, type PersistentWorkspaceInfo, type WorkspaceInfo } from "../providers";
import { WORKSPACE_EVENTS } from "../events/workspace";
import { githubAppService } from "../service/github";
import { workspaceJWT } from "../service/workspace-jwt";
import { githubAppInstallation } from "@gitpad/db/schema/integrations";

export const workspaceRouter = router({

  listUserInstallations: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    const installations = await db.select().from(githubAppInstallation).where(eq(githubAppInstallation.userId, userId));

    return {
      success: true,
      installations,
    };
  }),
  // List all agent types
  listAgentTypes: protectedProcedure.query(async () => {
    try {
      const types = await db.select().from(agentType);
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
          .where(eq(image.agentTypeId, input.agentTypeId));
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
        with: {
          regions: true,
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

  // List all workspaces for the authenticated user
  listWorkspaces: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    try {
      const workspaces = await db
        .select()
        .from(workspace)
        .where(eq(workspace.userId, userId));

      return {
        success: true,
        workspaces,
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
        repo: z.string(),
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

      if (fetchedUser && !fetchedUser.allowTrial) 
        throw new TRPCError({ code: "FORBIDDEN", message: "Reachout for Access" });

      try {
        // Check quota first
        const hasQuota = await hasRemainingQuota(userId);
        if (!hasQuota) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Daily free tier limit reached. Please try again tomorrow.",
          });
        }

        // Get cloud provider info
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

        // Get image for this agent type (take the first one)
        const [imageRecord] = await db
          .select()
          .from(image)
          .where(eq(image.agentTypeId, input.agentTypeId));

        if (!imageRecord) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No image found for this agent type",
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
        const installation = await githubAppService.getUserInstallation(userId, input.gitInstallationId);
        if (installation && !installation.suspended) {
          try {
              const tokenData = await githubAppService.getUserToServerToken(installation.installationId);
              githubAppToken = tokenData.token;
              githubAppTokenExpiry = tokenData.expiresAt;
            } catch (error) {
              console.error("Failed to generate GitHub App token:", error);
              // Continue without token - user can still use workspace without git operations
            }
          }
        }

        // Parse repo URL to get owner/name
        const repoInfo = input.repo ? githubAppService.parseRepoUrl(input.repo) : null;

        // Generate unique subdomain
        let subdomain: string;
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
        } while (
          await db
            .select()
            .from(workspace)
            .where(eq(workspace.subdomain, subdomain))
            .limit(1)
            .then((rows) => rows.length > 0)
        );

        // Generate workspace-scoped JWT token (replaces shared INTERNAL_API_KEY)
        const workspaceAuthToken = workspaceJWT.generateToken(
          workspaceId,
          userId,
          ['git:*', 'git:fork', 'git:refresh'] // All git scopes
        );

        // API endpoint for workspace operations
        const WORKSPACE_API_URL = process.env.WORKSPACE_API_URL || process.env.INTERNAL_API_URL || "https://api.gitterm.dev/trpc";

        // Generate domain (assuming a base domain like gitterm.dev)
        const baseDomain = process.env.BASE_DOMAIN || "gitterm.dev";
        const domain = `${subdomain}.${baseDomain}`;

        const DEFAULT_DOCKER_ENV_VARS = {
          "REPO_URL": input.repo,
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
              imageId: imageRecord.id,
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
            repositoryUrl: input.repo,
            domain,
            subdomain,
            backendUrl: workspaceInfo.backendUrl,
            status: "pending",
            startedAt: new Date(workspaceInfo.serviceCreatedAt),
            lastActiveAt: new Date(workspaceInfo.serviceCreatedAt),
            updatedAt: new Date(workspaceInfo.serviceCreatedAt),
          })
          .returning();

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


        // Create usage session for billing
        await createUsageSession(workspaceId, userId);

        // Emit status event
        WORKSPACE_EVENTS.emitStatus({
          workspaceId,
          status: "pending",
          updatedAt: new Date(workspaceInfo.serviceCreatedAt),
          userId,
          workspaceDomain: domain,
        });

        return {
          success: true,
          message: "Workspace created successfully",
          workspace: newWorkspace,
          volume: newVolume,
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

