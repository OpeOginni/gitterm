import z from "zod";
import { workspaceAuthProcedure, router } from "../../index";
import { db, eq, and, gt } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import { gitIntegration, workspaceGitConfig } from "@gitterm/db/schema/integrations";
import { TRPCError } from "@trpc/server";
import { githubAppService, GitHubInstallationNotFoundError } from "../../service/github";
import { workspaceJWT } from "../../service/workspace-jwt";
import { logger } from "../../utils/logger";

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
  /**
   * Fork repository
   * Called from workspace terminal via git-fork.sh
   * Requires scope: git:fork
   */
  forkRepository: workspaceAuthProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        owner: z.string(),
        repo: z.string(),
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

      // Check scope
      if (!workspaceJWT.hasScope(workspaceAuth, 'git:fork')) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Insufficient scope for fork operation",
        });
      }

      // Verify workspace exists and belongs to user
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

      if (ws.userId !== workspaceAuth.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Workspace ownership mismatch",
        });
      }

      // Verify workspace is running
      if (ws.status !== "running" && ws.status !== "pending") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Workspace is not active",
        });
      }

      try {
        const userId = ws.userId;

        // Get GitHub App installation using the specific installation ID
        const [gitIntegrationRecord] = await db
          .select()
          .from(gitIntegration)
          .where(and(
            eq(gitIntegration.userId, userId), 
            eq(gitIntegration.provider, "github")
          ));

        if (!gitIntegrationRecord) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "GitHub App not connected",
          });
        }

        // Verify installation and auto-cleanup if deleted on GitHub
        const installation = await githubAppService.getUserInstallation(
          userId, 
          gitIntegrationRecord.providerInstallationId,
          true // verify
        );

        if (!installation) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "GitHub App not connected or has been removed",
          });
        }

        if (installation.suspended) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "GitHub App installation is suspended",
          });
        }

        // Rate limiting - max 3 forks per minute
        const recentForks = await db
          .select()
          .from(workspaceGitConfig)
          .where(
            and(
              eq(workspaceGitConfig.userId, userId),
              gt(workspaceGitConfig.forkCreatedAt, new Date(Date.now() - 60000))
            )
          );

        if (recentForks.length >= 3) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many fork requests. Please wait a minute.",
          });
        }

        // Fork the repository
        const fork = await githubAppService.forkRepository(
          installation.installationId,
          input.owner,
          input.repo
        );

        // Update or create workspace git config
        const [existingConfig] = await db
          .select()
          .from(workspaceGitConfig)
          .where(eq(workspaceGitConfig.workspaceId, input.workspaceId));

        if (existingConfig) {
          await db
            .update(workspaceGitConfig)
            .set({
              repositoryUrl: fork.cloneUrl,
              repositoryOwner: fork.owner,
              repositoryName: fork.repo,
              isFork: true,
              originalOwner: input.owner,
              originalRepo: input.repo,
              forkCreatedAt: new Date(),
              defaultBranch: fork.defaultBranch,
              updatedAt: new Date(),
            })
            .where(eq(workspaceGitConfig.id, existingConfig.id));
        } else {
          await db.insert(workspaceGitConfig).values({
            workspaceId: input.workspaceId,
            userId,
            provider: "github",
            repositoryUrl: fork.cloneUrl,
            repositoryOwner: fork.owner,
            repositoryName: fork.repo,
            isFork: true,
            originalOwner: input.owner,
            originalRepo: input.repo,
            forkCreatedAt: new Date(),
            defaultBranch: fork.defaultBranch,
          });
        }

        // Generate authenticated URL
        const { token } = await githubAppService.getUserToServerToken(installation.installationId);
        const authenticatedUrl = githubAppService.getAuthenticatedGitUrl(token, fork.owner, fork.repo);

        logger.info("Fork operation completed", {
          workspaceId: input.workspaceId,
          userId,
          action: "fork_repository",
        });

        return {
          success: true,
          fork: {
            owner: fork.owner,
            repo: fork.repo,
            cloneUrl: fork.cloneUrl,
            authenticatedUrl,
            htmlUrl: fork.htmlUrl,
            defaultBranch: fork.defaultBranch,
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        
        // Handle installation not found specifically
        if (error instanceof GitHubInstallationNotFoundError) {
          logger.warn("GitHub installation not found during fork", {
            workspaceId: input.workspaceId,
            action: "fork_repository",
          });
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "GitHub App installation has been removed. Please reconnect.",
          });
        }
        
        logger.error("Failed to fork repository", {
          workspaceId: input.workspaceId,
          action: "fork_repository",
        }, error as Error);
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fork repository",
        });
      }
    }),

  /**
   * Refresh GitHub App token
   * Returns a new short-lived token for git operations
   * Requires scope: git:refresh
   */
  refreshGitToken: workspaceAuthProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
      })
    )
    .query(async ({ input, ctx }) => {
      const { workspaceAuth } = ctx;

      // Verify workspace ID matches token
      if (workspaceAuth.workspaceId !== input.workspaceId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Token workspace mismatch",
        });
      }

      // Check scope
      if (!workspaceJWT.hasScope(workspaceAuth, 'git:refresh')) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Insufficient scope for token refresh",
        });
      }

      // Verify workspace exists and belongs to user
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

      if (ws.userId !== workspaceAuth.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Workspace ownership mismatch",
        });
      }

      // Verify workspace is running
      if (ws.status !== "running" && ws.status !== "pending") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Workspace is not active",
        });
      }

      try {
        const userId = ws.userId;

        const [gitIntegrationRecord] = await db
          .select()
          .from(gitIntegration)
          .where(and(
            eq(gitIntegration.userId, userId), 
            eq(gitIntegration.provider, "github")
          ));

        // we only support GitHub for now
        if (!gitIntegrationRecord) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "GitHub App not connected",
          });
        }

        // Get GitHub App installation with verification
        const installation = await githubAppService.getUserInstallation(
          userId, 
          gitIntegrationRecord.providerInstallationId,
          true // verify
        );

        if (!installation) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "GitHub App not connected or has been removed",
          });
        }

        if (installation.suspended) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "GitHub App installation is suspended",
          });
        }

        // Generate new token
        const tokenData = await githubAppService.getUserToServerToken(installation.installationId);

        logger.info("Git token refresh completed", {
          workspaceId: input.workspaceId,
          userId,
          action: "refresh_git_token",
        });

        return {
          success: true,
          token: tokenData.token,
          expiresAt: tokenData.expiresAt,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        
        // Handle installation not found specifically
        if (error instanceof GitHubInstallationNotFoundError) {
          logger.warn("GitHub installation not found during token refresh", {
            workspaceId: input.workspaceId,
            action: "refresh_git_token",
          });
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "GitHub App installation has been removed. Please reconnect.",
          });
        }
        
        logger.error("Failed to refresh token", {
          workspaceId: input.workspaceId,
          action: "refresh_git_token",
        }, error as Error);
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to refresh GitHub token",
        });
      }
    }),
});
