import type { WorkspaceConfig, WorkspaceProvisioningSpec } from "./compute";

function decodeBase64(value: string | undefined): string {
  if (!value) return "";
  return Buffer.from(value, "base64").toString("utf8");
}

/**
 * Resolve the provisioning spec a provider should apply.
 *
 * Prefers the explicit `config.provisioningSpec` (the clean path used by
 * `createWorkspace`). Falls back to deriving the spec from the flat env for
 * legacy callers that only pass `environmentVariables` (e.g. the anon "try"
 * flow). This is the single place env → spec derivation happens, so providers
 * never hand-parse provisioning fields out of env.
 */
export function resolveProvisioningSpec(config: WorkspaceConfig): WorkspaceProvisioningSpec | null {
  if (config.provisioningSpec) {
    return config.provisioningSpec;
  }

  const env = config.environmentVariables;
  if (!env) {
    return null;
  }

  const repo = config.repositoryUrl
    ? {
        url: config.repositoryUrl,
        branch: config.repositoryBranch?.trim() || env.REPO_BRANCH?.trim() || undefined,
        name: env.REPO_NAME,
        authUsername: env.GITHUB_APP_TOKEN ? env.USER_GITHUB_USERNAME : undefined,
        authToken: env.GITHUB_APP_TOKEN,
      }
    : undefined;

  return {
    opencodeConfigJson: decodeBase64(env.OPENCODE_CONFIG_BASE64),
    opencodeCredentialsJson: decodeBase64(env.OPENCODE_CREDENTIALS_BASE64),
    repo,
    serverPassword: env.OPENCODE_SERVER_PASSWORD,
    sshPublicKey: env.USER_SSH_PUBLIC_KEY,
    workspaceProfile: env.WORKSPACE_PROFILE ?? "standard",
    editorAccessEnabled: env.EDITOR_ACCESS_ENABLED === "true",
  };
}
