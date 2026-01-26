import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { db, eq, and } from "@gitterm/db";
import {
  githubAppInstallation,
  gitIntegration,
  workspaceGitConfig,
} from "@gitterm/db/schema/integrations";
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
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "GitHubAPIError";
  }
}

/**
 * Decode the private key if it's base64 encoded
 */
function decodePrivateKey(key: string): string {
  // Check if the key is base64 encoded (doesn't start with -----)
  if (!key.startsWith("-----BEGIN")) {
    try {
      // Decode base64 to get the actual PEM key
      const decoded = Buffer.from(key, "base64").toString("utf-8");
      return decoded;
    } catch (error) {
      throw new Error("Invalid GitHub App private key format");
    }
  }

  // Key is already in PEM format, just handle escaped newlines
  return key.replace(/\\n/g, "\n");
}

/**
 * Check if error is a 404 Not Found from GitHub API
 */
function isNotFoundError(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
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
   * Check if a repository is valid, exists, and can be cloned.
   * - valid: URL parses as a GitHub repo
   * - exists: repo exists on GitHub (we got 200 or 403)
   * - canClone: we can reach it (public, or with the user's integration we have access)
   *
   * @param repositoryUrl - HTTPS or SSH GitHub URL
   * @param options - If provided, use the user's GitHub App integration to check access (for private repos)
   */
  async checkIfValidRepository(
    repositoryUrl: string,
    options?: { userId: string; gitIntegrationId: string },
  ): Promise<{ valid: boolean; exists: boolean; canClone: boolean }> {
    const parsed = this.parseRepoUrl(repositoryUrl);
    if (!parsed) {
      return { valid: false, exists: false, canClone: false };
    }
    const { owner, repo } = parsed;

    if(!options?.userId || !options?.gitIntegrationId) {
      // Try unauthenticated (public repos)
      const anonOctokit = new Octokit();
      try {
        await anonOctokit.repos.get({ owner, repo });
        return { valid: true, exists: true, canClone: true };
      } catch (e: unknown) {
          logger.warn(`checkIfValidRepository: unauthenticated request failed for ${owner}/${repo}`, {
            action: "check_if_valid_repo",
          });
          return { valid: true, exists: false, canClone: false };
        // 404: not found or private — try with user's integration if provided
      }
    }

    const [integration] = await db
    .select()
    .from(gitIntegration)
    .where(
      and(
        eq(gitIntegration.id, options.gitIntegrationId),
        eq(gitIntegration.userId, options.userId),
        eq(gitIntegration.provider, "github"),
      ),
    )
    .limit(1);


    if (!integration) {
      return { valid: true, exists: false, canClone: false };
    }

    const installation = await this.getUserInstallation(options.userId, integration.providerInstallationId);

    if (!installation) {
      return { valid: true, exists: false, canClone: false };
    }

    try {
      const { token } = await this.getUserToServerToken(installation.installationId);
      const userOctokit = new Octokit({ auth: token });
      await userOctokit.repos.get({ owner, repo });
      return { valid: true, exists: true, canClone: true };
    } catch (e: unknown) {
      if (isNotFoundError(e)) {
        return { valid: true, exists: false, canClone: false };
      }
      if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 403) {
        return { valid: true, exists: true, canClone: false };
      }
      logger.error(`checkIfValidRepository: auth request failed for ${owner}/${repo}`, {
        action: "check_if_valid_repo",
      }, e as Error);
      return { valid: true, exists: false, canClone: false };
    }
  }

  /**
   * Get a user-to-server access token for a specific installation
   * This token is short-lived (1 hour) and scoped to the installation's permissions
   */
  async getUserToServerToken(
    installationId: string,
    repositories?: string[] | undefined,
  ): Promise<{ token: string; expiresAt: string }> {
    try {
      const { data } = await this.appOctokit.apps.createInstallationAccessToken({
        installation_id: parseInt(installationId),
        repositories: repositories,
      });

      return {
        token: data.token,
        expiresAt: data.expires_at,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new GitHubInstallationNotFoundError(installationId);
      }
      logger.error(
        "Failed to create installation access token",
        { action: "create_token" },
        error as Error,
      );
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
   * This method directly cleans up the database (doesn't rely on webhook)
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
            eq(gitIntegration.providerInstallationId, installationId),
          ),
        )
        .limit(1);

      if (gitIntegrationRecord) {
        // Find all workspace git configs using this integration
        const workspaceConfigs = await db
          .select()
          .from(workspaceGitConfig)
          .where(eq(workspaceGitConfig.gitIntegrationId, gitIntegrationRecord.id));

        logger.info(
          `Found ${workspaceConfigs.length} workspace git config(s) using this integration`,
          {
            userId,
            action: "cleanup_workspace_configs",
          },
        );

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

      // Directly clean up the database records (don't rely on webhook)
      await this.removeInstallationByInstallationId(installationId);

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
    repositories: string[],
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
      logger.error(
        "Failed to create repository-scoped token",
        { action: "create_repo_token" },
        error as Error,
      );
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
    repo: string,
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
    repo: string,
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
    verify: boolean = true,
  ): Promise<typeof githubAppInstallation.$inferSelect | null> {
    try {
      const [installation] = await db
        .select()
        .from(githubAppInstallation)
        .where(
          and(
            eq(githubAppInstallation.userId, userId),
            eq(githubAppInstallation.installationId, installationId),
          ),
        )
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
      logger.error(
        "Failed to get user installation",
        { userId, action: "get_installation" },
        error as Error,
      );
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
      logger.debug("Fetching installation details from GitHub", {
        action: "get_installation_details",
      });

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
          login: "login" in account ? account.login : (account.name ?? ""),
          type: "type" in account ? account.type : "NO_TYPE",
        },
        repositorySelection: data.repository_selection,
        permissions: (data.permissions || {}) as Record<string, string>,
        suspended: data.suspended_at !== null && data.suspended_at !== undefined,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new GitHubInstallationNotFoundError(installationId);
      }
      logger.error(
        "Failed to fetch installation details from GitHub",
        { action: "get_installation_details" },
        error as Error,
      );
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

      // Check if installation already exists with this exact installationId
      const [existingInstallation] = await db
        .select()
        .from(githubAppInstallation)
        .where(
          and(
            eq(githubAppInstallation.userId, data.userId),
            eq(githubAppInstallation.installationId, data.installationId),
          ),
        );

      if (existingInstallation) {
        logger.info("Installation exists, updating", {
          userId: data.userId,
          action: "update_installation",
        });
        // Update existing installation
        const [updated] = await db
          .update(githubAppInstallation)
          .set({
            accountLogin: data.accountLogin,
            repositorySelection: data.repositorySelection,
            suspended: false,
            suspendedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(githubAppInstallation.id, existingInstallation.id))
          .returning();

        // Also update the gitIntegration record
        await db
          .update(gitIntegration)
          .set({
            providerAccountLogin: data.accountLogin,
            providerInstallationId: data.installationId,
            providerAccountId: data.accountId,
            active: true,
            updatedAt: new Date(),
          })
          .where(
            and(eq(gitIntegration.userId, data.userId), eq(gitIntegration.provider, "github")),
          );

        return updated!;
      }

      // Check if user has an existing GitHub integration (possibly with old installationId)
      const [existingIntegration] = await db
        .select()
        .from(gitIntegration)
        .where(and(eq(gitIntegration.userId, data.userId), eq(gitIntegration.provider, "github")));

      // Delete any old githubAppInstallation records for this user
      // (they reinstalled with a new installation ID)
      await db.delete(githubAppInstallation).where(eq(githubAppInstallation.userId, data.userId));

      logger.info("Creating new GitHub installation", {
        userId: data.userId,
        action: "create_installation",
      });
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

      if (existingIntegration) {
        // Update existing git integration with new installation details
        logger.info("Updating existing git integration with new installation", {
          userId: data.userId,
          action: "update_git_integration",
        });
        await db
          .update(gitIntegration)
          .set({
            providerAccountLogin: data.accountLogin,
            providerInstallationId: data.installationId,
            providerAccountId: data.accountId,
            active: true,
            updatedAt: new Date(),
          })
          .where(eq(gitIntegration.id, existingIntegration.id));
      } else {
        // Create new git integration record
        await db.insert(gitIntegration).values({
          userId: data.userId,
          provider: "github",
          providerAccountLogin: data.accountLogin,
          providerInstallationId: data.installationId,
          providerAccountId: data.accountId,
        });
      }

      logger.info("Successfully stored GitHub installation", {
        userId: data.userId,
        action: "installation_stored",
      });
      return installation!;
    } catch (error) {
      logger.error(
        "Failed to store GitHub installation",
        { userId: data.userId, action: "store_installation" },
        error as Error,
      );
      throw new Error("Failed to store GitHub App installation");
    }
  }

  /**
   * Request GitHub to uninstall the app
   * This only calls GitHub API - database cleanup happens via webhook
   *
   * @param installationId - The GitHub installation ID
   * @returns true if uninstall was successful or installation already deleted
   */
  async requestUninstallFromGitHub(installationId: string): Promise<boolean> {
    try {
      logger.info("Requesting GitHub App uninstall from GitHub", {
        installationId,
        action: "request_github_uninstall",
      });

      await this.appOctokit.apps.deleteInstallation({
        installation_id: parseInt(installationId),
      });

      logger.info("Successfully requested GitHub App uninstall from GitHub", {
        installationId,
        action: "github_uninstall_requested",
      });

      return true;
    } catch (githubError) {
      // If the installation doesn't exist on GitHub (404), that's fine
      // This can happen if the user already uninstalled from GitHub's side
      if (
        githubError instanceof Error &&
        "status" in githubError &&
        (githubError as { status: number }).status === 404
      ) {
        logger.info("GitHub App installation not found on GitHub (already uninstalled)", {
          installationId,
          action: "github_uninstall_not_found",
        });
        return true;
      }

      // For other errors, throw
      logger.error("Failed to request GitHub App uninstall from GitHub", {
        installationId,
        action: "github_uninstall_failed",
        error: githubError instanceof Error ? githubError.message : "Unknown error",
      });
      throw githubError;
    }
  }

  /**
   * @deprecated Use requestUninstallFromGitHub() instead. Database cleanup now happens via webhook.
   *
   * Remove GitHub App installation from database
   * This is kept for backward compatibility but should not be called directly.
   * Database cleanup is now handled by the webhook handler via removeInstallationByInstallationId()
   */
  async removeInstallation(userId: string, installationId: string): Promise<void> {
    // Just call the GitHub API - webhook will handle DB cleanup
    await this.requestUninstallFromGitHub(installationId);
    logger.info("GitHub App uninstall requested - database cleanup will happen via webhook", {
      userId,
      installationId,
      action: "remove_installation_deprecated",
    });
  }

  /**
   * Generate authenticated Git URL for cloning
   * Format: https://x-access-token:<token>@github.com/owner/repo.git
   */
  getAuthenticatedGitUrl(token: string, owner: string, repo: string): string {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }

  /**
   * List repositories accessible through a GitHub App installation
   * Paginates through all repos (up to maxRepos limit)
   */
  async listAccessibleRepos(
    installationId: string,
    maxRepos: number = 500,
  ): Promise<
    {
      id: number;
      name: string;
      fullName: string;
      owner: string;
      private: boolean;
      defaultBranch: string;
      htmlUrl: string;
    }[]
  > {
    try {
      const { token } = await this.getUserToServerToken(installationId);
      const userOctokit = new Octokit({ auth: token });

      const allRepos: {
        id: number;
        name: string;
        fullName: string;
        owner: string;
        private: boolean;
        defaultBranch: string;
        htmlUrl: string;
      }[] = [];

      let page = 1;
      const perPage = 100;

      while (allRepos.length < maxRepos) {
        const { data } = await userOctokit.apps.listReposAccessibleToInstallation({
          per_page: perPage,
          page,
        });

        const repos = data.repositories.map((repo) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          owner: repo.owner.login,
          private: repo.private,
          defaultBranch: repo.default_branch,
          htmlUrl: repo.html_url,
        }));

        allRepos.push(...repos);

        // If we got fewer than perPage, we've reached the end
        if (repos.length < perPage) {
          break;
        }

        page++;
      }

      return allRepos.slice(0, maxRepos);
    } catch (error) {
      if (error instanceof GitHubInstallationNotFoundError) {
        throw error;
      }
      logger.error("Failed to list accessible repos", { action: "list_repos" }, error as Error);
      throw new GitHubAPIError("Failed to list accessible repositories");
    }
  }

  /**
   * List branches for a repository
   */
  async listBranches(
    installationId: string,
    owner: string,
    repo: string,
  ): Promise<
    {
      name: string;
      protected: boolean;
    }[]
  > {
    try {
      const { token } = await this.getUserToServerToken(installationId);
      const userOctokit = new Octokit({ auth: token });

      const { data } = await userOctokit.repos.listBranches({
        owner,
        repo,
        per_page: 100,
      });

      return data.map((branch) => ({
        name: branch.name,
        protected: branch.protected,
      }));
    } catch (error) {
      if (error instanceof GitHubInstallationNotFoundError) {
        throw error;
      }
      logger.error("Failed to list branches", { action: "list_branches" }, error as Error);
      throw new GitHubAPIError("Failed to list branches");
    }
  }

  /**
   * Get file tree for a repository (recursive)
   */
  async getFileTree(
    installationId: string,
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<
    {
      path: string;
      type: "blob" | "tree";
      size?: number;
    }[]
  > {
    try {
      const { token } = await this.getUserToServerToken(installationId);
      const userOctokit = new Octokit({ auth: token });

      // Get the default branch if ref not provided
      const branch = ref || (await this.getRepository(installationId, owner, repo)).defaultBranch;

      const { data } = await userOctokit.git.getTree({
        owner,
        repo,
        tree_sha: branch,
        recursive: "true",
      });

      return data.tree
        .filter((item) => item.path && item.type)
        .map((item) => ({
          path: item.path!,
          type: item.type as "blob" | "tree",
          size: item.size,
        }));
    } catch (error) {
      if (error instanceof GitHubInstallationNotFoundError) {
        throw error;
      }
      logger.error("Failed to get file tree", { action: "get_file_tree" }, error as Error);
      throw new GitHubAPIError("Failed to get file tree");
    }
  }

  /**
   * Search files in a repository by name pattern
   * Filters by file extensions (txt, md, json)
   */
  async searchFiles(
    installationId: string,
    owner: string,
    repo: string,
    query: string,
    ref?: string,
    extensions: string[] = ["txt", "md", "json"],
  ): Promise<
    {
      path: string;
      name: string;
      size?: number;
    }[]
  > {
    try {
      const tree = await this.getFileTree(installationId, owner, repo, ref);

      const lowerQuery = query.toLowerCase();
      const extPattern = new RegExp(`\\.(${extensions.join("|")})$`, "i");

      return tree
        .filter((item) => {
          if (item.type !== "blob") return false;
          if (!extPattern.test(item.path)) return false;
          const fileName = item.path.split("/").pop() || "";
          return fileName.toLowerCase().includes(lowerQuery);
        })
        .map((item) => ({
          path: item.path,
          name: item.path.split("/").pop() || item.path,
          size: item.size,
        }))
        .slice(0, 50); // Limit results
    } catch (error) {
      if (error instanceof GitHubInstallationNotFoundError) {
        throw error;
      }
      logger.error("Failed to search files", { action: "search_files" }, error as Error);
      throw new GitHubAPIError("Failed to search files");
    }
  }

  /**
   * Get file contents
   */
  async getFileContents(
    installationId: string,
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<{
    content: string;
    encoding: string;
    size: number;
    sha: string;
  }> {
    try {
      const { token } = await this.getUserToServerToken(installationId);
      const userOctokit = new Octokit({ auth: token });

      const { data } = await userOctokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      if (Array.isArray(data) || data.type !== "file") {
        throw new GitHubAPIError("Path is not a file");
      }

      return {
        content: data.content,
        encoding: data.encoding,
        size: data.size,
        sha: data.sha,
      };
    } catch (error) {
      if (error instanceof GitHubInstallationNotFoundError || error instanceof GitHubAPIError) {
        throw error;
      }
      logger.error("Failed to get file contents", { action: "get_file_contents" }, error as Error);
      throw new GitHubAPIError("Failed to get file contents");
    }
  }

  /**
   * Remove GitHub App installation by installation ID only (for webhook handling)
   * This is used when GitHub sends a webhook that the app was uninstalled,
   * where we don't have the userId context from a session
   */
  async removeInstallationByInstallationId(installationId: string): Promise<{
    deletedInstallations: number;
    deletedIntegrations: number;
  }> {
    try {
      logger.info("Removing GitHub installation by installationId (webhook)", {
        installationId,
        action: "webhook_remove_installation",
      });

      // First, mark all git integrations with this installation as inactive
      const updatedIntegrations = await db
        .update(gitIntegration)
        .set({
          active: false,
          updatedAt: new Date(),
        })
        .where(eq(gitIntegration.providerInstallationId, installationId))
        .returning();

      if (updatedIntegrations.length > 0) {
        logger.info(`Marked ${updatedIntegrations.length} git integration(s) as inactive`, {
          installationId,
          action: "deactivate_integrations",
        });
      }

      // Delete GitHub App installation records
      const deletedInstallations = await db
        .delete(githubAppInstallation)
        .where(eq(githubAppInstallation.installationId, installationId))
        .returning();

      logger.info(`Deleted ${deletedInstallations.length} GitHub installation record(s)`, {
        installationId,
        action: "delete_installations",
      });

      // Delete generic git integration records
      const deletedIntegrations = await db
        .delete(gitIntegration)
        .where(eq(gitIntegration.providerInstallationId, installationId))
        .returning();

      logger.info(`Deleted ${deletedIntegrations.length} git integration record(s)`, {
        installationId,
        action: "delete_integrations",
      });

      logger.info("Successfully removed GitHub installation via webhook", {
        installationId,
        action: "webhook_installation_removed",
      });

      return {
        deletedInstallations: deletedInstallations.length,
        deletedIntegrations: deletedIntegrations.length,
      };
    } catch (error) {
      logger.error(
        "Failed to remove GitHub installation via webhook",
        {
          installationId,
          action: "webhook_remove_installation",
        },
        error as Error,
      );
      throw new Error("Failed to remove GitHub App installation via webhook");
    }
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

// Lazy-loaded singleton instance
// This prevents errors when GitHub App is not configured (e.g., in listener service)
let _githubAppService: GitHubAppService | null = null;

/**
 * Get the GitHub App service instance (lazy-loaded)
 * Throws if GitHub App is not configured
 */
export function getGitHubAppService(): GitHubAppService {
  if (!_githubAppService) {
    _githubAppService = new GitHubAppService();
  }
  return _githubAppService;
}

/**
 * Check if GitHub App is configured
 */
export function isGitHubAppConfigured(): boolean {
  return !!env.GITHUB_APP_ID && !!env.GITHUB_APP_PRIVATE_KEY;
}
