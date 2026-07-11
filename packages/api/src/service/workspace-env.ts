/**
 * Workspace provisioning + environment assembly.
 *
 * The provisioning spec (`WorkspaceProvisioningSpec`) is the single source of
 * truth for what a workspace needs: which repo to clone and which agent files
 * to write. Agent-specific content (config formats, credential files, launch
 * commands) is produced by the agent provisioners in `./agents`; from the spec
 * we derive:
 *  - the env handed to container providers (Railway/AWS) for their Docker
 *    entrypoint, via `buildWorkspaceEnv`, and
 *  - SDK providers (E2B/Daytona) apply the spec directly (see
 *    `resolveProvisioningSpec` in `providers/provisioning-spec.ts`).
 */

import {
  RESERVED_WORKSPACE_ENV_KEYS,
  type AgentFile,
  type AgentProvisioning,
  type SystemWorkspaceEnv,
  type WorkspaceEnvironmentVariables,
  type WorkspaceProvisioningSpec,
  type WorkspaceRepoProvisioning,
} from "../providers/compute";

function toBase64(json: string): string {
  return Buffer.from(json).toString("base64");
}

/** Base64-encoded JSON manifest of the agent's files, for container transport. */
export function encodeAgentFiles(files: AgentFile[]): string {
  return toBase64(JSON.stringify(files));
}

/** Decode an `AGENT_FILES_BASE64` manifest back into a file list. */
export function decodeAgentFiles(encoded: string | undefined): AgentFile[] {
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface BuildWorkspaceProvisioningSpecParams {
  agent: AgentProvisioning;
  repo?: WorkspaceRepoProvisioning | null;
  serverPassword?: string;
  sshPublicKey?: string;
  workspaceProfile: string;
  editorAccessEnabled: boolean;
}

/**
 * Build the paradigm-agnostic provisioning spec — the single source of truth
 * consumed by both container providers (via env) and SDK providers (directly).
 */
export function buildWorkspaceProvisioningSpec(
  params: BuildWorkspaceProvisioningSpecParams,
): WorkspaceProvisioningSpec {
  return {
    agent: params.agent,
    repo: params.repo ?? undefined,
    serverPassword: params.serverPassword,
    sshPublicKey: params.sshPublicKey,
    workspaceProfile: params.workspaceProfile,
    editorAccessEnabled: params.editorAccessEnabled,
  };
}

export interface BuildWorkspaceEnvRuntimeParams {
  githubUsername?: string;
  githubAppToken?: string;
  githubAppTokenExpiry?: string;
  toolingManifestBase64: string;
  repoOwner?: string;
  workspaceId: string;
  workspaceAuthToken: string;
  workspaceApiUrl: string;
  workspaceProvider: string;
  /** User-defined env vars; reserved system keys are stripped before merge. */
  userEnv?: Record<string, string | undefined> | null;
}

/**
 * Serialize a provisioning spec + runtime params into the env object handed to
 * a compute provider. The spec covers what to clone / write; `runtime` covers
 * the workspace-identity and callback vars the in-workspace process needs.
 *
 * Merge order: agent env < user env < system env. A user var can override the
 * agent's derived env (e.g. their own ANTHROPIC_API_KEY) but never a reserved
 * system key.
 */
export function buildWorkspaceEnv(
  spec: WorkspaceProvisioningSpec,
  runtime: BuildWorkspaceEnvRuntimeParams,
): WorkspaceEnvironmentVariables {
  const system: SystemWorkspaceEnv = {
    REPO_URL: spec.repo?.url,
    REPO_BRANCH: spec.repo?.branch,
    REPO_BASE_COMMIT: spec.repo?.baseCommit,
    REPO_CHECKOUT_REF: spec.repo?.checkoutRef,
    AGENT_FILES_BASE64: encodeAgentFiles(spec.agent.files),
    USER_GITHUB_USERNAME: runtime.githubUsername,
    GITHUB_APP_TOKEN: runtime.githubAppToken,
    GITHUB_APP_TOKEN_EXPIRY: runtime.githubAppTokenExpiry,
    WORKSPACE_TOOLING_MANIFEST_BASE64: runtime.toolingManifestBase64,
    REPO_OWNER: runtime.repoOwner,
    REPO_NAME: spec.repo?.name,
    WORKSPACE_ID: runtime.workspaceId,
    WORKSPACE_AUTH_TOKEN: runtime.workspaceAuthToken,
    WORKSPACE_API_URL: runtime.workspaceApiUrl,
    WORKSPACE_PROVIDER: runtime.workspaceProvider,
    WORKSPACE_PROFILE: spec.workspaceProfile,
    EDITOR_ACCESS_ENABLED: spec.editorAccessEnabled ? "true" : "false",
    USER_SSH_PUBLIC_KEY: spec.sshPublicKey,
  };

  return mergeEnv(system, spec.agent.env, runtime.userEnv);
}

/**
 * Merge agent-derived and user-defined env vars under the system env. User
 * vars win over agent vars; nothing overrides a reserved system key.
 */
function mergeEnv(
  system: SystemWorkspaceEnv,
  agentEnv: Record<string, string>,
  userEnv?: Record<string, string | undefined> | null,
): WorkspaceEnvironmentVariables {
  const merged: WorkspaceEnvironmentVariables = { ...system };

  for (const [key, value] of Object.entries(agentEnv)) {
    if (RESERVED_WORKSPACE_ENV_KEYS.has(key)) {
      continue;
    }
    merged[key] = value;
  }

  if (userEnv) {
    for (const [key, value] of Object.entries(userEnv)) {
      if (RESERVED_WORKSPACE_ENV_KEYS.has(key)) {
        continue;
      }
      merged[key] = value;
    }
  }

  return merged;
}
