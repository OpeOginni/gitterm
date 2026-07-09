/**
 * Workspace provisioning + environment assembly.
 *
 * The provisioning spec (`WorkspaceProvisioningSpec`) is the single source of
 * truth for what a workspace needs: which repo to clone and which opencode
 * files to write. From it we derive:
 *  - the env handed to container providers (Railway/AWS) for their Docker
 *    entrypoint, via `buildWorkspaceEnv`, and
 *  - SDK providers (E2B/Daytona) apply the spec directly (see
 *    `resolveProvisioningSpec` in `providers/provisioning-spec.ts`).
 */

import { db, eq } from "@gitterm/db";
import { modelProvider, userModelCredential } from "@gitterm/db/schema/model-credentials";
import { getModelCredentialsService } from "./credentials/model-credentials";
import {
  RESERVED_WORKSPACE_ENV_KEYS,
  type SystemWorkspaceEnv,
  type WorkspaceEnvironmentVariables,
  type WorkspaceProvisioningSpec,
  type WorkspaceRepoProvisioning,
} from "../providers/compute";

function toBase64(json: string): string {
  return Buffer.from(json).toString("base64");
}

/**
 * Assemble the opencode `auth.json` JSON from a user's stored model credentials
 * (API keys and OAuth tokens). Returns the stringified JSON; callers base64-
 * encode it when serializing to env.
 */
export async function buildOpencodeCredentialsJson(userId: string): Promise<string> {
  const credService = getModelCredentialsService();

  const userCredentials = await db
    .select()
    .from(userModelCredential)
    .where(eq(userModelCredential.userId, userId))
    .leftJoin(modelProvider, eq(userModelCredential.providerId, modelProvider.id));

  const credentialsEntries = (
    await Promise.all(
      userCredentials.map(async (cred) => {
        const decryptedCred = await credService.getUserCredentialForProvider(
          userId,
          cred.model_provider?.name as string,
        );
        if (!decryptedCred) return null;

        // openai-codex credentials are written under the "openai" provider key.
        const providerName =
          decryptedCred.providerName === "openai-codex" ? "openai" : decryptedCred.providerName;

        return [
          providerName,
          {
            type: decryptedCred.credential.type === "api_key" ? "api" : "oauth",
            key:
              decryptedCred.credential.type === "api_key"
                ? decryptedCred.credential.apiKey
                : undefined,
            refresh:
              decryptedCred.credential.type === "oauth"
                ? decryptedCred.credential.refresh
                : undefined,
            access:
              decryptedCred.credential.type === "oauth"
                ? decryptedCred.credential.access
                : undefined,
            expires:
              decryptedCred.credential.type === "oauth"
                ? decryptedCred.credential.expires
                : undefined,
            accountId:
              decryptedCred.credential.type === "oauth"
                ? decryptedCred.credential.accountId
                : undefined,
          },
        ] as const;
      }),
    )
  ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return JSON.stringify(Object.fromEntries(credentialsEntries));
}

export interface BuildWorkspaceProvisioningSpecParams {
  opencodeConfigJson: string;
  opencodeCredentialsJson: string;
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
    opencodeConfigJson: params.opencodeConfigJson,
    opencodeCredentialsJson: params.opencodeCredentialsJson,
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
 * User-defined vars can never override a reserved system key.
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
    OPENCODE_CONFIG_BASE64: toBase64(spec.opencodeConfigJson),
    OPENCODE_CREDENTIALS_BASE64: toBase64(spec.opencodeCredentialsJson),
    OPENCODE_SERVER_PASSWORD: spec.serverPassword,
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

  return mergeUserEnv(system, runtime.userEnv);
}

/**
 * Merge user-defined env vars over the system env, skipping any key reserved by
 * the system. Stops a user var from silently clobbering, e.g.,
 * WORKSPACE_AUTH_TOKEN.
 */
function mergeUserEnv(
  system: SystemWorkspaceEnv,
  userEnv?: Record<string, string | undefined> | null,
): WorkspaceEnvironmentVariables {
  const merged: WorkspaceEnvironmentVariables = { ...system };

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
