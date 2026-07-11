import { decodeAgentFiles } from "../service/workspace-env";
import type { WorkspaceConfig, WorkspaceProvisioningSpec } from "./compute";

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
        baseCommit:
          config.repositoryBaseCommit?.trim() || env.REPO_BASE_COMMIT?.trim() || undefined,
        checkoutRef:
          config.repositoryCheckoutRef?.trim() || env.REPO_CHECKOUT_REF?.trim() || undefined,
        name: env.REPO_NAME,
        authUsername: env.GITHUB_APP_TOKEN ? env.USER_GITHUB_USERNAME : undefined,
        authToken: env.GITHUB_APP_TOKEN,
      }
    : undefined;

  const serverPassword =
    typeof env.OPENCODE_SERVER_PASSWORD === "string" ? env.OPENCODE_SERVER_PASSWORD : undefined;

  return {
    agent: {
      files: decodeAgentFiles(env.AGENT_FILES_BASE64),
      env: serverPassword ? { OPENCODE_SERVER_PASSWORD: serverPassword } : {},
      // The only env-only caller is the anon "try" flow, which is always an
      // OpenCode workspace.
      serve: {
        command: "opencode serve --hostname 0.0.0.0 --port 4096",
        port: 4096,
      },
      usesServerPassword: true,
    },
    repo,
    serverPassword,
    sshPublicKey: env.USER_SSH_PUBLIC_KEY,
    workspaceProfile: env.WORKSPACE_PROFILE ?? "standard",
    editorAccessEnabled: env.EDITOR_ACCESS_ENABLED === "true",
  };
}
