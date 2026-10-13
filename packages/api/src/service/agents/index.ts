import { opencodeProvisioner } from "./opencode";
import { t3codeProvisioner } from "./t3code";
import type { AgentProvisioner } from "./types";
import type { AgentProvisionerKey } from "@gitterm/schema/workspace-catalog";

export { getUserProviderCredentials, resolveWorkspaceProviderCredentials } from "./credentials";
export type { AgentProvisioner, AgentProvisionerContext, UserProviderCredential } from "./types";

const provisioners: Record<AgentProvisionerKey, AgentProvisioner> = {
  opencode: opencodeProvisioner,
  t3code: t3codeProvisioner,
};

export function getAgentProvisioner(provisionerKey: string): AgentProvisioner {
  if (!Object.hasOwn(provisioners, provisionerKey)) {
    throw new Error(`Unsupported agent provisioner: ${provisionerKey}`);
  }
  return provisioners[provisionerKey as AgentProvisionerKey];
}
