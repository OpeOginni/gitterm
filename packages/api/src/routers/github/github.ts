import z from "zod";
import { accountProcedure, protectedProcedure, router } from "../../index";
import {
  GitHubAPIError,
  getGitHubAppService,
  getPublicGitHubRepository,
  parseGitHubRepoUrl,
} from "../../service/github";
import { githubRepositoryMode } from "../../service/github/config";
import { TRPCError } from "@trpc/server";
import { db, eq, and } from "@gitterm/db";
import { githubAppInstallation, gitIntegration } from "@gitterm/db/schema/integrations";
import { logger } from "../../utils/logger";
import { integrationPolicy } from "../../service/integrations/catalog";

export const githubRouter = router({
  appAvailability: accountProcedure("workspace:read").query(async () => {
    const policy = await integrationPolicy("github");
    const config = await githubRepositoryMode();
    return {
      enabled: policy.enabled,
      configured: policy.enabled && config?.mode === "app",
      mode: policy.enabled ? (config?.mode ?? null) : null,
      slug: config?.mode === "app" ? config.slug : null,
      accountLogin: config?.mode === "pat" ? config.accountLogin : null,
      patSuffix: config?.mode === "pat" ? config.patSuffix : null,
    };
  }),
  /**
   * Get GitHub App installation status for the current user
   * Returns the installation from our database without verifying against GitHub API
   * Cleanup happens via webhook when the app is uninstalled
   */
  getInstallationStatus: protectedProcedure.query(async ({ ctx }) => {
    if ((await githubRepositoryMode())?.mode !== "app")
      return { connected: false, installations: [] };
    const userId = ctx.session.user.id;

    try {
      const records = await db
        .select({
          integrationId: gitIntegration.id,
          installationId: githubAppInstallation.installationId,
          accountLogin: githubAppInstallation.accountLogin,
          accountType: githubAppInstallation.accountType,
          repositorySelection: githubAppInstallation.repositorySelection,
          installedAt: githubAppInstallation.installedAt,
          suspended: githubAppInstallation.suspended,
        })
        .from(gitIntegration)
        .innerJoin(
          githubAppInstallation,
          eq(gitIntegration.providerInstallationId, githubAppInstallation.installationId),
        )
        .where(
          and(
            eq(gitIntegration.userId, userId),
            eq(githubAppInstallation.userId, userId),
            eq(gitIntegration.provider, "github"),
            eq(gitIntegration.active, true),
          ),
        );

      return {
        connected: records.length > 0,
        installations: records.map(({ installationId, ...record }) => ({
          ...record,
          id: installationId,
        })),
      };
    } catch (error) {
      logger.error(
        "Failed to get installation status",
        { userId, action: "get_installation_status" },
        error as Error,
      );
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get installation status",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  /**
   * Disconnect GitHub App
   * This requests GitHub to uninstall the app - database cleanup happens via webhook
   */
  disconnectApp: protectedProcedure
    .input(z.object({ integrationId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      try {
        const [gitIntegrationRecord] = await db
          .select()
          .from(gitIntegration)
          .where(
            and(
              eq(gitIntegration.id, input.integrationId),
              eq(gitIntegration.userId, userId),
              eq(gitIntegration.provider, "github"),
            ),
          );

        if (!gitIntegrationRecord) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "GitHub App not connected",
          });
        }

        // Request GitHub to uninstall the app
        // Database cleanup will happen via webhook when GitHub sends the "deleted" event
        await (
          await getGitHubAppService()
        ).requestUninstallFromGitHub(gitIntegrationRecord.providerInstallationId);

        logger.info("GitHub App disconnect requested - awaiting webhook for cleanup", {
          userId,
          installationId: gitIntegrationRecord.providerInstallationId,
          action: "disconnect_app",
        });

        return {
          success: true,
          message: "GitHub App disconnect requested. Changes will take effect shortly.",
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        logger.error(
          "Failed to disconnect GitHub App",
          {
            userId,
            action: "disconnect_app",
          },
          error as Error,
        );

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
      if (!(await integrationPolicy("github")).enabled)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "GitHub repository integration is disabled",
        });
      const userId = ctx.session.user.id;

      try {
        // Verify the installation belongs to the user
        const [gitIntegrationRecord] = await db
          .select()
          .from(gitIntegration)
          .where(
            and(
              eq(gitIntegration.userId, userId),
              eq(gitIntegration.providerInstallationId, input.installationId),
            ),
          );

        if (!gitIntegrationRecord) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "GitHub installation not found",
          });
        }

        const repos = await (await getGitHubAppService()).listAccessibleRepos(input.installationId);

        return { repos };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        logger.error(
          "Failed to list accessible repos",
          {
            userId,
            action: "list_repos",
          },
          error as Error,
        );

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to list accessible repositories",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  /**
   * Resolve repository metadata for a pasted GitHub URL.
   */
  resolveRepository: protectedProcedure
    .input(
      z.object({
        repositoryUrl: z.string().trim().min(1),
        gitIntegrationId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (input.gitIntegrationId && !(await integrationPolicy("github")).enabled)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "GitHub repository integration is disabled",
        });
      const userId = ctx.session.user.id;
      const parsed = parseGitHubRepoUrl(input.repositoryUrl);

      if (!parsed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter a valid GitHub repository URL",
        });
      }

      try {
        if (!input.gitIntegrationId) {
          const repository = await getPublicGitHubRepository(parsed.owner, parsed.repo);

          return {
            repository: {
              owner: repository.owner,
              repo: repository.repo,
              fullName: `${repository.owner}/${repository.repo}`,
              htmlUrl: repository.htmlUrl,
              defaultBranch: repository.defaultBranch,
              private: repository.private,
            },
          };
        }

        const [gitIntegrationRecord] = await db
          .select()
          .from(gitIntegration)
          .where(
            and(
              eq(gitIntegration.id, input.gitIntegrationId),
              eq(gitIntegration.userId, userId),
              eq(gitIntegration.provider, "github"),
            ),
          );

        if (!gitIntegrationRecord) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "GitHub integration not found",
          });
        }

        const installation = await (
          await getGitHubAppService()
        ).getUserInstallation(userId, gitIntegrationRecord.providerInstallationId);

        if (!installation) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "GitHub installation not found",
          });
        }

        const repository = await (
          await getGitHubAppService()
        ).getRepository(installation.installationId, parsed.owner, parsed.repo);

        return {
          repository: {
            owner: repository.owner,
            repo: repository.repo,
            fullName: `${repository.owner}/${repository.repo}`,
            htmlUrl: repository.htmlUrl,
            defaultBranch: repository.defaultBranch,
            private: repository.private,
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        if (error instanceof GitHubAPIError && error.statusCode === 404) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: input.gitIntegrationId
              ? "That repository is not available through the selected integration"
              : "That repository is not publicly accessible. Select Repository Access for private repos.",
          });
        }

        if (error instanceof GitHubAPIError && error.statusCode === 403) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: input.gitIntegrationId
              ? "This integration cannot access that repository"
              : "GitHub blocked the public lookup for that repository right now",
          });
        }

        logger.error(
          "Failed to resolve repository",
          {
            userId,
            action: "resolve_repository",
          },
          error as Error,
        );

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to resolve repository",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  /**
   * List branches for a repository
   */
  listBranches: protectedProcedure
    .input(
      z.object({
        installationId: z.string(),
        owner: z.string(),
        repo: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!(await integrationPolicy("github")).enabled)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "GitHub repository integration is disabled",
        });
      const userId = ctx.session.user.id;

      try {
        // Verify the installation belongs to the user
        const [gitIntegrationRecord] = await db
          .select()
          .from(gitIntegration)
          .where(
            and(
              eq(gitIntegration.userId, userId),
              eq(gitIntegration.providerInstallationId, input.installationId),
            ),
          );

        if (!gitIntegrationRecord) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "GitHub installation not found",
          });
        }

        const branches = await (
          await getGitHubAppService()
        ).listBranches(input.installationId, input.owner, input.repo);

        return { branches };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        logger.error(
          "Failed to list branches",
          {
            userId,
            action: "list_branches",
          },
          error as Error,
        );

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to list branches",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),
});
