import { TRPCError } from "@trpc/server";
import { inArray } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import {
  createSandboxTransport,
  SANDBOX_PROVIDERS,
  type SandboxProviderKey,
  type SandboxTransport,
} from "@gitterm/agent-runtime/sandbox/index";
import { getProviderConfigService } from "./config/provider-config";
import { createAwsSandboxTransport } from "../providers/aws/sandbox";

/**
 * Managed sandboxes keep their provider handle as `sandbox:<provider>:<id>` in
 * `workspace.externalInstanceId`, so lifecycle code can tell them from agent workspaces.
 */
const HANDLE_PREFIX = "sandbox:";

export function sandboxHandle(provider: SandboxProviderKey, id: string): string {
  return `${HANDLE_PREFIX}${provider}:${id}`;
}

/**
 * Matches a workspace by the provider's own id, whether it stores the bare id (agent
 * workspaces) or a sandbox handle. Provider webhooks only know the bare id.
 */
export function externalIdMatches(provider: SandboxProviderKey, providerId: string) {
  return inArray(workspace.externalInstanceId, [providerId, sandboxHandle(provider, providerId)]);
}

export function parseSandboxHandle(
  handle: string,
): { provider: SandboxProviderKey; id: string } | null {
  if (!handle.startsWith(HANDLE_PREFIX)) return null;
  const rest = handle.slice(HANDLE_PREFIX.length);
  const separator = rest.indexOf(":");
  const provider = rest.slice(0, separator) as SandboxProviderKey;
  if (separator < 1 || !SANDBOX_PROVIDERS.includes(provider)) return null;
  return { provider, id: rest.slice(separator + 1) };
}

/** The deployment's provider account, configured by an admin. Credentials never leave the server. */
export async function managedSandboxTransport(
  provider: SandboxProviderKey,
  cloudProviderId?: string,
): Promise<SandboxTransport> {
  if (provider === "aws") {
    if (!cloudProviderId)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "AWS sandboxes need a configured AWS provider.",
      });
    return createAwsSandboxTransport(cloudProviderId);
  }
  const config = (await getProviderConfigService().getProviderConfigForUse(provider)) as Record<
    string,
    string | undefined
  > | null;
  const missing = () =>
    new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Managed ${provider} sandboxes need the ${provider} provider to be configured by an admin.`,
    });
  if (!config) throw missing();
  switch (provider) {
    case "e2b":
      if (!config.apiKey) throw missing();
      return createSandboxTransport({ provider, apiKey: config.apiKey });
    case "daytona":
      if (!config.apiKey) throw missing();
      return createSandboxTransport({
        provider,
        apiKey: config.apiKey,
        target: config.defaultTargetRegion === "eu" ? "eu" : "us",
      });
    case "vercel":
      if (!config.apiToken || !config.teamId || !config.projectId) throw missing();
      return createSandboxTransport({
        provider,
        apiKey: config.apiToken,
        teamId: config.teamId,
        projectId: config.projectId,
      });
    case "boat":
      if (!config.apiKey) throw missing();
      return createSandboxTransport({ provider, apiKey: config.apiKey });
    case "exedev":
      if (!config.apiToken) throw missing();
      return createSandboxTransport({ provider, apiKey: config.apiToken });
    case "railway":
      if (!config.apiToken || !config.projectId || !config.environmentId) throw missing();
      return createSandboxTransport({
        provider,
        apiKey: config.apiToken,
        projectId: config.projectId,
        environmentId: config.environmentId,
        apiUrl: config.apiUrl,
      });
  }
}
