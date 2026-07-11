import { opencodeProvisioner } from "./opencode";
import { t3codeProvisioner } from "./t3code";
import type { AgentProvisioner } from "./types";

export { getUserProviderCredentials } from "./credentials";
export type { AgentProvisioner, AgentProvisionerContext, UserProviderCredential } from "./types";

export function getAgentProvisioner(agentTypeName: string): AgentProvisioner {
  const normalized = agentTypeName.trim().toLowerCase();
  if (normalized.startsWith("t3code")) return t3codeProvisioner;
  return opencodeProvisioner;
}
