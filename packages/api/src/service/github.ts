import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { db, eq, and } from "@gitterm/db";
import { githubAppInstallation, gitIntegration, workspaceGitConfig } from "@gitterm/db/schema/integrations";
import { logger } from "../utils/logger";
import env from "@gitterm/env/server";

/**
 * GitHub API error types
 */
export class GitHubInstallationNotFoundError extends Error {
  constructor(installationId: string) {
    super(`GitHub installation ${installationId} not found or has been deleted`);
    this.name = "GitHubInstallationNotFoundError";
  }
}

export class GitHubAPIError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "GitHubAPIError";
  }
}

/**
 * Decode the private key if it's base64 encoded
 */
function decodePrivateKey(key: string): string {
  // Check if the key is base64 encoded (doesn't start with -----)
  if (!key.startsWith('-----BEGIN')) {
    try {
      // Decode base64 to get the actual PEM key
      const decoded = Buffer.from(key, 'base64').toString('utf-8');
      logger.debug("Decoded base64 GitHub private key");
      return decoded;
    } catch (error) {
      logger.error("Failed to decode base64 GitHub private key", {}, error as Error);
      throw new Error("Invalid GitHub App private key format");
    }
  }
  
  // Key is already in PEM format, just handle escaped newlines
  return key.replace(/\\n/g, '\n');
}

/**
 * Check if error is a 404 Not Found from GitHub API
 */
function isNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    return (error as { status: number }).status === 404;
  }
  return false;
}

/**
 * GitHub App Service
 * 
 * Handles all GitHub App operations:
 * - Installation management
 * - Token generation
 * - Repository operations (clone, fork, push)
 * 
 * This service uses GitHub App authentication, which is separate from OAuth.
 * OAuth is used for user login, GitHub App is used for git operations.
 */
export class GitHubAppService {
  private appOctokit: Octokit;

  constructor() {
    const GITHUB_APP_ID = env.GITHUB_APP_ID;
    const GITHUB_APP_PRIVATE_KEY = env.GITHUB_APP_PRIVATE_KEY;

    if (!GITHUB_APP_ID) {
      throw new Error("GITHUB_APP_ID is required for GitHub App integration");
    }

    if (!GITHUB_APP_PRIVATE_KEY) {
      throw new Error("GITHUB_APP_PRIVATE_KEY is required for GitHub App integration");
    }

    // Decode and prepare the private key
    const privateKey = decodePrivateKey(GITHUB_APP_PRIVATE_KEY!);
    
    logger.info("Initializing GitHub App Service", { action: "github_init" });
    
    // Initialize Octokit with App authentication
    this.appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: GITHUB_APP_ID,
        privateKey,
      },
    });
  }

  /**
   * Get a user-to-server access token for a specific installation
   * This token is short-lived (1 hour) and scoped to the installation's permissions
   */
  async getUserToServerToken(installationId: string): Promise<{ token: string; expiresAt: string }> {
    try {
      const { data } = await this.appOctokit.apps.createInstallationAccessToken({
        installation_id: parseInt(installationId),
      });

      return {
        token: data.token,
        expiresAt: data.expires_at,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new GitHubInstallationNotFoundError(installationId);
      }
      logger.error("Failed to create installation access token", { action: "create_token" }, error as Error);
      throw new GitHubAPIError("Failed to generate GitHub access token");
    }
  }

  /**
   * Verify that a GitHub installation still exists and is valid
   * If the installation is deleted on GitHub's side, clean up our local records
   * 
   * @param userId - The user ID who owns the installation
   * @param installationId - The GitHub installation ID
   * @returns true if installation is valid, false if it was deleted/cleaned up
   */
  async verifyAndCleanupInstallation(userId: string, installationId: string): Promise<boolean> {
    try {
      // Try to get installation details from GitHub
      await this.getInstallationDetails(installationId);
      // Installation exists and is valid
      return true;
    } catch (error) {
      // Check if this is a 404 (installation deleted on GitHub's side)
      if (error instanceof GitHubInstallationNotFoundError || isNotFoundError(error)) {
        logger.warn("GitHub installation no longer exists, cleaning up local records", {
          userId,
          action: "installation_cleanup",
        });
        
        // Clean up our local records
        await this.cleanupStaleInstallation(userId, installationId);
        return false;
      }
      
      // Other errors (network, auth, etc.) - don't cleanup, just throw
      throw error;
    }
  }

  /**
   * Clean up stale GitHub installation and related records
   * This is called when we detect an installation has been deleted on GitHub's side
   * 
   * @param userId - The user ID
   * @param installationId - The GitHub installation ID
   */
  private async cleanupStaleInstallation(userId: string, installationId: string): Promise<void> {
    try {
      logger.info("Starting cleanup of stale GitHub installation", {
        userId,
        action: "cleanup_stale_installation",
      });

      // Get the git integration record first (we'll need its ID)
      const [gitIntegrationRecord] = await db
        .select()
        .from(gitIntegration)
        .where(
          and(
            eq(gitIntegration.userId, userId),
            eq(gitIntegration.providerInstallationId, installationId)
          )
        )
        .limit(1);

      if (gitIntegrationRecord) {
        // Find all workspace git configs using this integration
        const workspaceConfigs = await db
          .select()
          .from(workspaceGitConfig)
          .where(eq(workspaceGitConfig.gitIntegrationId, gitIntegrationRecord.id));

        logger.info(`Found ${workspaceConfigs.length} workspace git config(s) using this integration`, {
          userId,
          action: "cleanup_workspace_configs",
        });

        // Nullify the gitIntegrationId in workspace configs (keep the configs for history)
        if (workspaceConfigs.length > 0) {
          await db
            .update(workspaceGitConfig)
            .set({
              gitIntegrationId: null,
              updatedAt: new Date(),
            })
            .where(eq(workspaceGitConfig.gitIntegrationId, gitIntegrationRecord.id));
          
          logger.info("Nullified gitIntegrationId in workspace configs", {
            userId,
            action: "nullify_git_integration",
          });
        }
      }

      // Now remove the installation (this also handles git integration deletion)
      await this.removeInstallation(userId, installationId);

      logger.info("Successfully cleaned up stale GitHub installation", {
        userId,
        action: "cleanup_complete",
      });
    } catch (error) {
      logger.error("Failed to cleanup stale installation", { userId }, error as Error);
      throw new Error("Failed to cleanup stale GitHub installation");
    }
  }

  /**
   * Get a repository-scoped token
   * Even more restrictive - only works for specific repositories
   */
  async getRepositoryScopedToken(
    installationId: string,
    repositories: string[]
  ): Promise<{ token: string; expiresAt: string }> {
    try {
      const { data } = await this.appOctokit.apps.createInstallationAccessToken({
        installation_id: parseInt(installationId),
        repositories,
      });

      return {
        token: data.token,
        expiresAt: data.expires_at,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new GitHubInstallationNotFoundError(installationId);
      }
      logger.error("Failed to create repository-scoped token", { action: "create_repo_token" }, error as Error);
      throw new GitHubAPIError("Failed to generate repository-scoped GitHub token");
    }
  }

  /**
   * Fork a repository on behalf of the user
   * Returns the new fork's details
   */
  async forkRepository(
    installationId: string,
    owner: string,
    repo: string
  ): Promise<{
    owner: string;
    repo: string;
    cloneUrl: string;
    htmlUrl: string;
    defaultBranch: string;
  }> {
    try {
      // Get installation token
      const { token } = await this.getUserToServerToken(installationId);
      
      // Create authenticated Octokit instance with the installation token
      const userOctokit = new Octokit({ auth: token });

      // Fork the repository
      const { data: fork } = await userOctokit.repos.createFork({
        owner,
        repo,
      });

      logger.info("Successfully forked repository", {
        action: "fork_repository",
        provider: "github",
      });

      return {
        owner: fork.owner.login,
        repo: fork.name,
        cloneUrl: fork.clone_url,
        htmlUrl: fork.html_url,
        defaultBranch: fork.default_branch,
      };
    } catch (error) {
      if (error instanceof GitHubInstallationNotFoundError) {
        throw error; // Re-throw for caller to handle cleanup
      }
      logger.error("Failed to fork repository", { action: "fork_repository" }, error as Error);
      throw new GitHubAPIError("Failed to fork repository");
    }
  }

  /**
   * Get repository information
   */
  async getRepository(
    installationId: string,
    owner: string,
    repo: string
  ): Promise<{
    owner: string;
    repo: string;
    cloneUrl: string;
    htmlUrl: string;
    defaultBranch: string;
    isFork: boolean;
    parent?: { owner: string; repo: string };
  }> {
    try {
      const { token } = await this.getUserToServerToken(installationId);
      const userOctokit = new Octokit({ auth: token });

      const { data } = await userOctokit.repos.get({
        owner,
        repo,
      });

      return {
        owner: data.owner.login,
        repo: data.name,
        cloneUrl: data.clone_url,
        htmlUrl: data.html_url,
        defaultBranch: data.default_branch,
        isFork: data.fork,
        parent: data.parent
          ? { owner: data.parent.owner.login, repo: data.parent.name }
          : undefined,
      };
    } catch (error) {
      if (error instanceof GitHubInstallationNotFoundError) {
        throw error; // Re-throw for caller to handle cleanup
      }
      logger.error("Failed to get repository", { action: "get_repository" }, error as Error);
      throw new GitHubAPIError("Failed to get repository information");
    }
  }

  /**
   * Get GitHub App installation for a user
   * Now includes automatic verification against GitHub API
   * 
   * @param userId - The user ID
   * @param installationId - The GitHub installation ID (text), not the database UUID
   * @param verify - Whether to verify installation still exists on GitHub (default: true)
   * @returns Installation record or null if not found or deleted
   */
  async getUserInstallation(
    userId: string, 
    installationId: string,
    verify: boolean = true
  ): Promise<typeof githubAppInstallation.$inferSelect | null> {
    try {
      const [installation] = await db
        .select()
        .from(githubAppInstallation)
        .where(and(eq(githubAppInstallation.userId, userId), eq(githubAppInstallation.installationId, installationId)))
        .limit(1);

      if (!installation) {
        return null;
      }

      // Optionally verify the installation still exists on GitHub's side
      if (verify) {
        const isValid = await this.verifyAndCleanupInstallation(userId, installationId);
        if (!isValid) {
          // Installation was deleted on GitHub's side and has been cleaned up
          return null;
        }
      }

      return installation;
    } catch (error) {
      logger.error("Failed to get user installation", { userId, action: "get_installation" }, error as Error);
      return null;
    }
  }

  /**
   * Get installation details from GitHub API
   * Returns full installation data including account info and permissions
   * Throws GitHubInstallationNotFoundError if installation doesn't exist (404)
   */
  async getInstallationDetails(installationId: string): Promise<{
    id: number;
    account: {
      id: number;
      login: string;
      type: string;
    };
    repositorySelection: string;
    permissions: Record<string, string>;
    suspended: boolean;
  }> {
    try {
      logger.debug("Fetching installation details from GitHub", { action: "get_installation_details" });
      
      // Use the app-level Octokit (authenticates as the app with JWT)
      // This is the correct way to get installation details
      const { data } = await this.appOctokit.apps.getInstallation({
        installation_id: parseInt(installationId),
      });

      // Handle account data - it can be a User or Organization
      const account = data.account;
      if (!account) {
        throw new Error("Installation account data is missing");
      }

      return {
        id: data.id,
        account: {
          id: account.id,
          login: 'login' in account ? account.login : account.name ?? '',
          type: 'type' in account ? account.type : 'NO_TYPE',
        },
        repositorySelection: data.repository_selection,
        permissions: (data.permissions || {}) as Record<string, string>,
        suspended: data.suspended_at !== null && data.suspended_at !== undefined,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new GitHubInstallationNotFoundError(installationId);
      }
      logger.error("Failed to fetch installation details from GitHub", { action: "get_installation_details" }, error as Error);
      throw new GitHubAPIError("Failed to fetch installation details from GitHub");
    }
  }

  /**
   * Store GitHub App installation
   */
  async storeInstallation(data: {
    userId: string;
    installationId: string;
    accountId: string;
    accountLogin: string;
    accountType: string;
    repositorySelection: string;
  }): Promise<typeof githubAppInstallation.$inferSelect> {
    try {
      logger.info("Storing GitHub installation", {
        userId: data.userId,
        action: "store_installation",
      });

      // Check if installation already exists
      const [existing] = await db
        .select()
        .from(githubAppInstallation)
        .where(
          and(
            eq(githubAppInstallation.userId, data.userId),
            eq(githubAppInstallation.installationId, data.installationId)
          )
        );

      if (existing) {
        logger.info("Installation exists, updating", { userId: data.userId, action: "update_installation" });
        // Update existing installation
        const [updated] = await db
          .update(githubAppInstallation)
          .set({
            accountLogin: data.accountLogin,
            repositorySelection: data.repositorySelection,
            updatedAt: new Date(),
          })
          .where(eq(githubAppInstallation.id, existing.id))
          .returning();

        return updated!;
      }

      logger.info("Creating new GitHub installation", { userId: data.userId, action: "create_installation" });
      // Create new installation
      const [installation] = await db
        .insert(githubAppInstallation)
        .values({
          userId: data.userId,
          installationId: data.installationId,
          accountId: data.accountId,
          accountLogin: data.accountLogin,
          accountType: data.accountType,
          repositorySelection: data.repositorySelection,
          installedAt: new Date(),
        })
        .returning();

      // Also create generic git integration record
      await db.insert(gitIntegration).values({
        userId: data.userId,
        provider: "github",
        providerAccountLogin: data.accountLogin,
        providerInstallationId: data.installationId,
        providerAccountId: data.accountId,
      });

      logger.info("Successfully stored GitHub installation", { userId: data.userId, action: "installation_stored" });
      return installation!;
    } catch (error) {
      logger.error("Failed to store GitHub installation", { userId: data.userId, action: "store_installation" }, error as Error);
      throw new Error("Failed to store GitHub App installation");
    }
  }

  /**
   * Remove GitHub App installation
   * Also cleans up related workspace git configs by nullifying their gitIntegrationId
   */
  async removeInstallation(userId: string, installationId: string): Promise<void> {
    try {
      logger.info("Removing GitHub installation", { userId, action: "remove_installation" });
      
      // First, get the git integration record to mark it as inactive before deletion
      const [gitIntegrationRecord] = await db
        .select()
        .from(gitIntegration)
        .where(
          and(
            eq(gitIntegration.userId, userId),
            eq(gitIntegration.providerInstallationId, installationId)
          )
        )
        .limit(1);

      if (gitIntegrationRecord) {
        // Mark as inactive before deletion (for audit trail)
        await db
          .update(gitIntegration)
          .set({ 
            active: false,
            updatedAt: new Date(),
          })
          .where(eq(gitIntegration.id, gitIntegrationRecord.id));
        
        logger.info("Marked git integration as inactive", { userId, action: "deactivate_integration" });
      }

      // Delete GitHub App installation record
      const deletedInstallation = await db
        .delete(githubAppInstallation)
        .where(
          and(
            eq(githubAppInstallation.userId, userId),
            eq(githubAppInstallation.installationId, installationId)
          )
        )
        .returning();
      
      logger.info(`Deleted ${deletedInstallation.length} GitHub installation record(s)`, { 
        userId, 
        action: "delete_installation" 
      });

      // Delete generic git integration record
      const deletedIntegration = await db
        .delete(gitIntegration)
        .where(
          and(
            eq(gitIntegration.userId, userId),
            eq(gitIntegration.providerInstallationId, installationId)
          )
        )
        .returning();
      
      logger.info(`Deleted ${deletedIntegration.length} git integration record(s)`, { 
        userId, 
        action: "delete_integration" 
      });
      
      logger.info("Successfully removed GitHub installation", { userId, action: "installation_removed" });
    } catch (error) {
      logger.error("Failed to remove GitHub installation", { userId, action: "remove_installation" }, error as Error);
      throw new Error("Failed to remove GitHub App installation");
    }
  }

  /**
   * Generate authenticated Git URL for cloning
   * Format: https://x-access-token:<token>@github.com/owner/repo.git
   */
  getAuthenticatedGitUrl(token: string, owner: string, repo: string): string {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }

  /**
   * Parse repository URL to extract owner and repo name
   */
  parseRepoUrl(url: string): { owner: string; repo: string } | null {
    // Handle various GitHub URL formats:
    // https://github.com/owner/repo
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    
    const httpsMatch = url.match(/github\.com\/([^\/]+)\/([^\/\.]+)(\.git)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
    }

    const sshMatch = url.match(/git@github\.com:([^\/]+)\/([^\/\.]+)(\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1]!, repo: sshMatch[2]! };
    }

    return null;
  }
}

// Export singleton instance
export const githubAppService = new GitHubAppService();
