import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { db, eq, and } from "@gitpad/db";
import { githubAppInstallation, gitIntegration } from "@gitpad/db/schema/integrations";

/**
 * Decode the private key if it's base64 encoded
 */
function decodePrivateKey(key: string): string {
  // Check if the key is base64 encoded (doesn't start with -----)
  if (!key.startsWith('-----BEGIN')) {
    try {
      // Decode base64 to get the actual PEM key
      const decoded = Buffer.from(key, 'base64').toString('utf-8');
      console.log("[decodePrivateKey] Decoded base64 key");
      return decoded;
    } catch (error) {
      console.error("[decodePrivateKey] Failed to decode base64 key:", error);
      throw new Error("Invalid GitHub App private key format");
    }
  }
  
  // Key is already in PEM format, just handle escaped newlines
  return key.replace(/\\n/g, '\n');
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
    const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
    const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!GITHUB_APP_ID) {
      throw new Error("GITHUB_APP_ID is required for GitHub App integration");
    }

    if (!GITHUB_APP_PRIVATE_KEY) {
      throw new Error("GITHUB_APP_PRIVATE_KEY is required for GitHub App integration");
    }

    // Decode and prepare the private key
    const privateKey = decodePrivateKey(GITHUB_APP_PRIVATE_KEY!);
    
    console.log("[GitHubAppService] Initializing with App ID:", GITHUB_APP_ID);
    console.log("[GitHubAppService] Private key starts with:", privateKey.substring(0, 30));
    
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
      console.error("Failed to create installation access token:", error);
      throw new Error("Failed to generate GitHub access token");
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
      console.error("Failed to create repository-scoped token:", error);
      throw new Error("Failed to generate repository-scoped GitHub token");
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

      return {
        owner: fork.owner.login,
        repo: fork.name,
        cloneUrl: fork.clone_url,
        htmlUrl: fork.html_url,
        defaultBranch: fork.default_branch,
      };
    } catch (error) {
      console.error("Failed to fork repository:", error);
      throw new Error("Failed to fork repository");
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
      console.error("Failed to get repository:", error);
      throw new Error("Failed to get repository information");
    }
  }

  /**
   * Get GitHub App installation for a user
   */
  async getUserInstallation(userId: string, gitIntegrationId: string): Promise<typeof githubAppInstallation.$inferSelect | null> {
    try {
      const [installation] = await db
        .select()
        .from(githubAppInstallation)
        .where(and(eq(githubAppInstallation.userId, userId), eq(gitIntegration.id, gitIntegrationId)))
        .limit(1);

      return installation || null;
    } catch (error) {
      console.error("Failed to get user installation:", error);
      return null;
    }
  }

  /**
   * Get installation details from GitHub API
   * Returns full installation data including account info and permissions
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
      console.log("[getInstallationDetails] Fetching for installation:", installationId);
      
      // Use the app-level Octokit (authenticates as the app with JWT)
      // This is the correct way to get installation details
      const { data } = await this.appOctokit.apps.getInstallation({
        installation_id: parseInt(installationId),
      });

      console.log("[getInstallationDetails] Got installation data:", {
        id: data.id,
        account: data.account,
        repositorySelection: data.repository_selection,
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
      console.error("[getInstallationDetails] ERROR:", error);
      if (error instanceof Error) {
        console.error("[getInstallationDetails] Error message:", error.message);
      }
      throw new Error("Failed to fetch installation details from GitHub");
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
      console.log("[storeInstallation] Storing installation:", {
        userId: data.userId,
        installationId: data.installationId,
        accountLogin: data.accountLogin,
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
        console.log("[storeInstallation] Installation exists, updating...");
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

        console.log("[storeInstallation] Updated existing installation:", updated?.id);
        return updated!;
      }

      console.log("[storeInstallation] Creating new installation...");
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

      console.log("[storeInstallation] Created installation:", installation?.id);

      // Also create generic git integration record
      console.log("[storeInstallation] Creating git integration record...");
      await db.insert(gitIntegration).values({
        userId: data.userId,
        provider: "github",
        providerAccountLogin: data.accountLogin,
        providerInstallationId: data.installationId,
        providerAccountId: data.accountId,
      });

      console.log("[storeInstallation] Success!");
      return installation!;
    } catch (error) {
      console.error("[storeInstallation] ERROR:", error);
      if (error instanceof Error) {
        console.error("[storeInstallation] Error message:", error.message);
        console.error("[storeInstallation] Error stack:", error.stack);
      }
      throw new Error("Failed to store GitHub App installation");
    }
  }

  /**
   * Remove GitHub App installation
   */
  async removeInstallation(userId: string, installationId: string): Promise<void> {
    try {
      await db
        .delete(githubAppInstallation)
        .where(
          and(
            eq(githubAppInstallation.userId, userId),
            eq(githubAppInstallation.installationId, installationId)
          )
        );

      // Also remove generic git integration
      await db
        .delete(gitIntegration)
        .where(
          and(
            eq(gitIntegration.userId, userId),
            eq(gitIntegration.providerInstallationId, installationId)
          )
        );
    } catch (error) {
      console.error("Failed to remove installation:", error);
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
