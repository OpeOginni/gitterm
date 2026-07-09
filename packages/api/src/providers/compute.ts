/**
 * Cloud-agnostic compute provider interface.
 * Implementations exist for Railway, AWS, Azure, etc.
 */

import type {
  WorkspaceSSHAccess,
  WorkspaceSSHAccessCleanupConfig,
  WorkspaceSSHAccessConfig,
} from "./ssh-access";
import type { ImageProviderMetadata } from "@gitterm/db/schema/cloud";

export type WorkspaceStatus = "pending" | "running" | "paused" | "terminated";

/**
 * System-owned workspace environment variables.
 *
 * These keys are assembled by GitTerm and are *reserved*: user-defined env vars
 * can never override them (see `RESERVED_WORKSPACE_ENV_KEYS`).
 *
 * Adding a new system env key is a single edit here — the env builder
 * (`buildWorkspaceEnv`) constructs this exact shape, so it fails to compile
 * until the new key is supplied.
 */
export interface SystemWorkspaceEnv {
  REPO_URL?: string;
  REPO_BRANCH?: string;
  /** Exact commit SHA to check out after clone (full SHA preferred). */
  REPO_BASE_COMMIT?: string;
  /** Optional checkout ref when distinct from display branch. */
  REPO_CHECKOUT_REF?: string;
  OPENCODE_CONFIG_BASE64: string;
  OPENCODE_CREDENTIALS_BASE64: string;
  OPENCODE_SERVER_PASSWORD?: string;
  USER_GITHUB_USERNAME?: string;
  GITHUB_APP_TOKEN?: string;
  GITHUB_APP_TOKEN_EXPIRY?: string;
  WORKSPACE_TOOLING_MANIFEST_BASE64: string;
  REPO_OWNER?: string;
  REPO_NAME?: string;
  WORKSPACE_ID: string;
  WORKSPACE_AUTH_TOKEN: string;
  WORKSPACE_API_URL: string;
  WORKSPACE_PROVIDER: string;
  WORKSPACE_PROFILE?: string;
  EDITOR_ACCESS_ENABLED?: string;
  USER_SSH_PUBLIC_KEY?: string;
}

/**
 * The full set of system-owned env keys. Listed explicitly so it can be used at
 * runtime to strip clashing user-defined vars. The `satisfies` clause rejects
 * any key not on `SystemWorkspaceEnv`, and `_ensureAllSystemKeysListed` below
 * rejects any system key missing from this list — keeping the two in sync at
 * compile time.
 */
export const SYSTEM_WORKSPACE_ENV_KEYS = [
  "REPO_URL",
  "REPO_BRANCH",
  "REPO_BASE_COMMIT",
  "REPO_CHECKOUT_REF",
  "OPENCODE_CONFIG_BASE64",
  "OPENCODE_CREDENTIALS_BASE64",
  "OPENCODE_SERVER_PASSWORD",
  "USER_GITHUB_USERNAME",
  "GITHUB_APP_TOKEN",
  "GITHUB_APP_TOKEN_EXPIRY",
  "WORKSPACE_TOOLING_MANIFEST_BASE64",
  "REPO_OWNER",
  "REPO_NAME",
  "WORKSPACE_ID",
  "WORKSPACE_AUTH_TOKEN",
  "WORKSPACE_API_URL",
  "WORKSPACE_PROVIDER",
  "WORKSPACE_PROFILE",
  "EDITOR_ACCESS_ENABLED",
  "USER_SSH_PUBLIC_KEY",
] as const satisfies readonly (keyof SystemWorkspaceEnv)[];

// Compile-time guard: every SystemWorkspaceEnv key must appear above.
type _MissingSystemEnvKeys = Exclude<
  keyof SystemWorkspaceEnv,
  (typeof SYSTEM_WORKSPACE_ENV_KEYS)[number]
>;
const _ensureAllSystemKeysListed: _MissingSystemEnvKeys extends never ? true : never = true;
void _ensureAllSystemKeysListed;

/** Reserved keys that user-defined env vars must not override. */
export const RESERVED_WORKSPACE_ENV_KEYS: ReadonlySet<string> = new Set(SYSTEM_WORKSPACE_ENV_KEYS);

/**
 * Final environment handed to a compute provider: the typed system keys plus
 * any user-defined vars (arbitrary string keys, already stripped of reserved
 * keys by the env builder).
 */
export type WorkspaceEnvironmentVariables = SystemWorkspaceEnv & Record<string, string | undefined>;

/**
 * Repository to clone into a workspace, with optional git basic-auth.
 */
export interface WorkspaceRepoProvisioning {
  /** Clone URL (providers append `.git` if missing). */
  url: string;
  branch?: string;
  /** Exact commit SHA the workspace should check out. */
  baseCommit?: string;
  /** Optional checkout ref (branch/tag) when providers need a named ref. */
  checkoutRef?: string;
  /** Repo name, used for the workspace directory and provider labels. */
  name?: string;
  /** Git basic-auth username (present only when a token is available). */
  authUsername?: string;
  /** Git basic-auth password / GitHub App token. */
  authToken?: string;
}

/**
 * Paradigm-agnostic description of how to provision a workspace's filesystem:
 * what to clone and which opencode files to write.
 *
 * This is the single source of truth for provisioning. Container providers
 * (Railway, AWS) serialize it to env for their Docker entrypoint via
 * `buildWorkspaceEnv`; SDK providers (E2B, Daytona) apply it directly through
 * their native clone + file APIs via `resolveProvisioningSpec`. The duplicated
 * "decode base64 → write auth.json/opencode.json + clone" logic now lives in
 * exactly one place per consumer.
 */
export interface WorkspaceProvisioningSpec {
  /** Stringified opencode.json contents. */
  opencodeConfigJson: string;
  /** Stringified auth.json contents. */
  opencodeCredentialsJson: string;
  /** Repository to clone, when the workspace has one. */
  repo?: WorkspaceRepoProvisioning;
  /** Password for serverOnly workspaces. */
  serverPassword?: string;
  /** Normalized OpenSSH public key for ssh-enabled workspaces. */
  sshPublicKey?: string;
  /** Workspace profile, e.g. "standard" | "ssh-enabled". */
  workspaceProfile: string;
  /** Whether editor (SSH) access is enabled. */
  editorAccessEnabled: boolean;
}

export interface WorkspaceConfig {
  workspaceId: string;
  userId: string;
  imageId: string;
  imageProviderMetadata?: ImageProviderMetadata;
  subdomain: string;
  repositoryUrl?: string;
  repositoryBranch?: string;
  repositoryBaseCommit?: string;
  repositoryCheckoutRef?: string;
  regionIdentifier?: string;
  /**
   * Runtime + container-transport env. Always present; container providers pass
   * it through to the Docker entrypoint, and it carries runtime vars (e.g.
   * WORKSPACE_AUTH_TOKEN) for the in-workspace process.
   */
  environmentVariables?: WorkspaceEnvironmentVariables;
  /**
   * Structured provisioning instructions. Preferred by SDK providers. When
   * absent (legacy callers), providers derive it from `environmentVariables`.
   */
  provisioningSpec?: WorkspaceProvisioningSpec;
}

export interface UpstreamAccess {
  headers: Record<string, string>;
}

export interface PersistentWorkspaceConfig extends WorkspaceConfig {
  persistent: boolean;
}

export interface WorkspaceInfo {
  externalServiceId: string;
  upstreamUrl: string; // URL to proxy requests to (e.g., Railway internal URL)
  upstreamAccess?: UpstreamAccess;
  domain: string;
  serviceCreatedAt: Date;
}

export interface PersistentWorkspaceInfo extends WorkspaceInfo {
  externalVolumeId: string;
  volumeCreatedAt: Date;
}

export interface WorkspaceStatusResult {
  status: WorkspaceStatus;
  lastActiveAt?: Date;
}

export interface ComputeProvider {
  /**
   * Provider name identifier (e.g., "railway", "aws", "azure")
   */
  readonly name: string;

  /**
   * Create a new workspace instance
   */
  createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo>;

  /**
   * Create a new persistent workspace instance (with a volume)
   */
  createPersistentWorkspace(config: PersistentWorkspaceConfig): Promise<PersistentWorkspaceInfo>;

  /**
   * Stop a workspace (scale to 0 replicas, but keep resources)
   */
  stopWorkspace(
    externalId: string,
    regionIdentifier?: string,
    externalRunningDeploymentId?: string,
  ): Promise<void>;

  /**
   * Restart a stopped workspace (scale back up)
   */
  restartWorkspace(
    externalId: string,
    regionIdentifier?: string,
    externalRunningDeploymentId?: string,
  ): Promise<void>;

  /**
   * Permanently delete/terminate a workspace
   */
  terminateWorkspace(externalServiceId: string, externalVolumeId?: string): Promise<void>;

  /**
   * Get current status of a workspace
   */
  getStatus(externalId: string): Promise<WorkspaceStatusResult>;

  /**
   * Refresh provider-side TTL for providers that automatically stop workspaces.
   */
  keepAliveWorkspace?(externalId: string, timeoutMs: number): Promise<void>;

  /**
   * Create or get a domain for an exposed port
   */
  createOrGetExposedPortDomain(
    externalServiceId: string,
    port: number,
  ): Promise<{
    domain: string;
    externalPortDomainId?: string;
    upstreamAccess?: UpstreamAccess;
  }>;

  /**
   * Build editor connection details for a running workspace.
   */
  getWorkspaceSSHAccess(config: WorkspaceSSHAccessConfig): Promise<WorkspaceSSHAccess>;

  /**
   * Revoke provider-managed editor access resources when no longer needed.
   */
  revokeWorkspaceSSHAccess(config: WorkspaceSSHAccessCleanupConfig): Promise<void>;

  /**
   * Remove a domain for an exposed port
   */
  removeExposedPortDomain(externalServiceDomainId: string): Promise<void>;
}

/**
 * Credential configuration for sandbox runs.
 * Either an API key or OAuth tokens (for GitHub Copilot, etc.)
 */
export type SandboxCredential =
  | {
      type: "api_key";
      apiKey: string;
    }
  | {
      type: "oauth";
      /** Provider name for the auth.json file (e.g., "github-copilot") */
      providerName: string;
      /** OAuth refresh token */
      refresh: string;
      /** OAuth access token */
      access: string;
      /** Token expiry timestamp (Unix ms) */
      expires: number;
    };

export interface StartSandboxRunConfig {
  /** Unique identifier for this sandbox instance */
  sandboxId: string;
  /** Repository owner (e.g., "octocat") */
  repoOwner: string;
  /** Repository name (e.g., "hello-world") */
  repoName: string;
  /** Branch to work on */
  branch: string;
  /** GitHub App installation token for git operations */
  gitAuthToken: string;
  /** Path to the plan/feature list file in the repo */
  planFilePath: string;
  /** Path to the progress file in the repo (optional) */
  documentedProgressPath?: string;
  /** AI provider (e.g., "anthropic", "openai") */
  provider: string;
  /** Model identifier (e.g., "anthropic/claude-sonnet-4-20250514") */
  modelId: string;
  /** Credential for the AI provider (API key or OAuth tokens) */
  credential: SandboxCredential;
  /** Custom prompt to send to the agent */
  prompt: string;
  /** Iteration number for the session */
  iteration: number;
  /** Callback URL for async completion notification */
  callbackUrl?: string;
  /** Secret for authenticating callback requests */
  callbackSecret?: string;
  /** Run ID for callback identification */
  runId?: string;
}

export interface SandboxProvider {
  readonly name: string;
}

/**
 * Legacy type for Cloudflare worker compatibility
 * Maps to StartSandboxRunConfig with different field names
 */
export interface SandboxConfig {
  userSandboxId: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  gitAuthToken: string;
  featureListPath: string;
  documentedProgressPath?: string;
  /** Model identifier (e.g., "anthropic/claude-sonnet-4-20250514") */
  modelId: string;
  /** Credential for the AI provider (API key or OAuth tokens) */
  credential: SandboxCredential;
  prompt: string;
  iteration: number;
  /** Callback URL for async completion notification */
  callbackUrl: string;
  /** Secret for authenticating callback requests */
  callbackSecret: string;
  /** Run ID for callback identification */
  runId: string;
}
