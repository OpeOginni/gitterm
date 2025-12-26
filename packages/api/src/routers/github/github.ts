import z from "zod";
import { protectedProcedure, router } from "../../index";
import { githubAppService } from "../../service/github";
import { TRPCError } from "@trpc/server";
import { db, eq, and } from "@gitterm/db";
import { workspaceGitConfig, gitIntegration } from "@gitterm/db/schema/integrations";
import { logger } from "../../utils/logger";

export const githubRouter = router({
  /**
   * Get GitHub App installation status for the current user
   * Now uses automatic verification and cleanup via getUserInstallation
   */
  getInstallationStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    try {
      const [gitIntegrationRecord] = await db
        .select()
        .from(gitIntegration)
        .where(and(
          eq(gitIntegration.userId, userId), 
          eq(gitIntegration.provider, "github")
        ));
      
      if (!gitIntegrationRecord) {
        return {
          connected: false,
          installation: null,
        };
      }

      // getUserInstallation now automatically verifies and cleans up if needed
      const installation = await githubAppService.getUserInstallation(
        userId, 
        gitIntegrationRecord.providerInstallationId,
        true // verify against GitHub API
      );

      if (!installation) {
        // Installation was either not found or deleted on GitHub's side
        return {
          connected: false,
          installation: null,
        };
      }

      return {
        connected: true,
        installation: {
          id: installation.id,
          accountLogin: installation.accountLogin,
          accountType: installation.accountType,
          repositorySelection: installation.repositorySelection,
          installedAt: installation.installedAt,
          suspended: installation.suspended,
        },
      };
    } catch (error) {
      logger.error("Failed to get installation status", { userId, action: "get_installation_status" }, error as Error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get installation status",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  /**
   * Handle GitHub App installation callback
   * Called after user installs the GitHub App
   */
  handleInstallation: protectedProcedure
    .input(
      z.object({
        installationId: z.string(),
        setupAction: z.enum(["install", "update"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      try {
        logger.info("Handling GitHub App installation", { 
          userId, 
          action: "handle_installation" 
        });
        
        // Get installation details from GitHub using SDK
        const installationData = await githubAppService.getInstallationDetails(
          input.installationId
        );

        // Store installation in database
        const installation = await githubAppService.storeInstallation({
          userId,
          installationId: input.installationId,
          accountId: installationData.account.id.toString(),
          accountLogin: installationData.account.login,
          accountType: installationData.account.type,
          repositorySelection: installationData.repositorySelection,
        });

        logger.info("GitHub App installation handled successfully", { 
          userId, 
          action: "installation_success" 
        });

        return {
          success: true,
          message: "GitHub App connected successfully",
          installation: {
            accountLogin: installation.accountLogin,
            repositorySelection: installation.repositorySelection,
          },
        };
      } catch (error) {
        logger.error("Failed to handle GitHub App installation", { 
          userId, 
          action: "handle_installation" 
        }, error as Error);
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to connect GitHub App",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  /**
   * Disconnect GitHub App
   */
  disconnectApp: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    try {
      const [gitIntegrationRecord] = await db
        .select()
        .from(gitIntegration)
        .where(and(
          eq(gitIntegration.userId, userId), 
          eq(gitIntegration.provider, "github")
        ));
      
      if (!gitIntegrationRecord) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "GitHub App not connected",
        });
      }

      // Don't verify here - if user wants to disconnect, let them disconnect
      // even if GitHub already deleted it
      const installation = await githubAppService.getUserInstallation(
        userId, 
        gitIntegrationRecord.providerInstallationId,
        false // skip verification
      );

      if (!installation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "GitHub App not connected",
        });
      }

      await githubAppService.removeInstallation(
        userId,
        installation.installationId
      );

      logger.info("GitHub App disconnected successfully", { 
        userId, 
        action: "disconnect_app" 
      });

      return {
        success: true,
        message: "GitHub App disconnected successfully",
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      
      logger.error("Failed to disconnect GitHub App", { 
        userId, 
        action: "disconnect_app" 
      }, error as Error);
      
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to disconnect GitHub App",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  /**
   * Get workspace git configuration
   */
  getWorkspaceGitConfig: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      try {
        const [config] = await db
          .select()
          .from(workspaceGitConfig)
          .where(eq(workspaceGitConfig.workspaceId, input.workspaceId));

        if (!config || config.userId !== userId) {
          return {
            hasGitConfig: false,
            config: null,
          };
        }

        return {
          hasGitConfig: true,
          config: {
            provider: config.provider,
            repositoryOwner: config.repositoryOwner,
            repositoryName: config.repositoryName,
            isFork: config.isFork,
            originalOwner: config.originalOwner,
            originalRepo: config.originalRepo,
            defaultBranch: config.defaultBranch,
            currentBranch: config.currentBranch,
          },
        };
      } catch (error) {
        logger.error("Failed to get workspace git configuration", { 
          userId, 
          workspaceId: input.workspaceId,
          action: "get_workspace_config" 
        }, error as Error);
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get workspace git configuration",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),
});
