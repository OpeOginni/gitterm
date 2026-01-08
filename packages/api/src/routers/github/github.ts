import z from "zod";
import { protectedProcedure, router } from "../../index";
import { getGitHubAppService } from "../../service/github";
import { TRPCError } from "@trpc/server";
import { db, eq, and } from "@gitterm/db";
import { workspaceGitConfig, gitIntegration } from "@gitterm/db/schema/integrations";
import { logger } from "../../utils/logger";

export const githubRouter = router({
  /**
   * Get GitHub App installation status for the current user
   * Returns the installation from our database without verifying against GitHub API
   * Cleanup happens via webhook when the app is uninstalled
   */
  getInstallationStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    try {
      const [gitIntegrationRecord] = await db
        .select()
        .from(gitIntegration)
        .where(and(
          eq(gitIntegration.userId, userId), 
          eq(gitIntegration.provider, "github"),
          eq(gitIntegration.active, true)
        ));
      
      if (!gitIntegrationRecord) {
        return {
          connected: false,
          installation: null,
        };
      }

      // Get installation from our database (don't verify against GitHub API)
      // Cleanup happens via webhook when the app is uninstalled
      const installation = await getGitHubAppService().getUserInstallation(
        userId, 
        gitIntegrationRecord.providerInstallationId,
        false // don't verify against GitHub API
      );

      if (!installation) {
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
        const installationData = await getGitHubAppService().getInstallationDetails(
          input.installationId
        );

        // Store installation in database
        const installation = await getGitHubAppService().storeInstallation({
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
   * This requests GitHub to uninstall the app - database cleanup happens via webhook
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

      // Request GitHub to uninstall the app
      // Database cleanup will happen via webhook when GitHub sends the "deleted" event
      await getGitHubAppService().requestUninstallFromGitHub(
        gitIntegrationRecord.providerInstallationId
      );

      logger.info("GitHub App disconnect requested - awaiting webhook for cleanup", { 
        userId,
        installationId: gitIntegrationRecord.providerInstallationId,
        action: "disconnect_app" 
      });

      return {
        success: true,
        message: "GitHub App disconnect requested. Changes will take effect shortly.",
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
   * List repositories accessible through a GitHub installation
   */
  listAccessibleRepos: protectedProcedure
    .input(z.object({ installationId: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      try {
        // Verify the installation belongs to the user
        const [gitIntegrationRecord] = await db
          .select()
          .from(gitIntegration)
          .where(and(
            eq(gitIntegration.userId, userId),
            eq(gitIntegration.providerInstallationId, input.installationId)
          ));

        if (!gitIntegrationRecord) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "GitHub installation not found",
          });
        }

        const repos = await getGitHubAppService().listAccessibleRepos(input.installationId);

        return { repos };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        logger.error("Failed to list accessible repos", {
          userId,
          action: "list_repos"
        }, error as Error);

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to list accessible repositories",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  /**
   * List branches for a repository
   */
  listBranches: protectedProcedure
    .input(z.object({
      installationId: z.string(),
      owner: z.string(),
      repo: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      try {
        // Verify the installation belongs to the user
        const [gitIntegrationRecord] = await db
          .select()
          .from(gitIntegration)
          .where(and(
            eq(gitIntegration.userId, userId),
            eq(gitIntegration.providerInstallationId, input.installationId)
          ));

        if (!gitIntegrationRecord) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "GitHub installation not found",
          });
        }

        const branches = await getGitHubAppService().listBranches(
          input.installationId,
          input.owner,
          input.repo
        );

        return { branches };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        logger.error("Failed to list branches", {
          userId,
          action: "list_branches"
        }, error as Error);

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to list branches",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  /**
   * Search files in a repository
   */
  searchFiles: protectedProcedure
    .input(z.object({
      installationId: z.string(),
      owner: z.string(),
      repo: z.string(),
      query: z.string(),
      ref: z.string().optional(),
      extensions: z.array(z.string()).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      try {
        // Verify the installation belongs to the user
        const [gitIntegrationRecord] = await db
          .select()
          .from(gitIntegration)
          .where(and(
            eq(gitIntegration.userId, userId),
            eq(gitIntegration.providerInstallationId, input.installationId)
          ));

        if (!gitIntegrationRecord) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "GitHub installation not found",
          });
        }

        const files = await getGitHubAppService().searchFiles(
          input.installationId,
          input.owner,
          input.repo,
          input.query,
          input.ref,
          input.extensions
        );

        return { files };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        logger.error("Failed to search files", {
          userId,
          action: "search_files"
        }, error as Error);

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to search files",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  /**
   * Get workspace git configuration
   */
  getWorkspaceGitConfig: protectedProcedure
    .input(z.object({ workspaceId: z.uuid() }))
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
