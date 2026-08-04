import { opencodeProvisioner } from "./opencode";
import { t3codeProvisioner } from "./t3code";
import type { AgentProvisioner } from "./types";

export { getUserProviderCredentials } from "./credentials";
export type { AgentProvisioner, AgentProvisionerContext, UserProviderCredential } from "./types";

export function getAgentProvisioner(provisionerKey: string): AgentProvisioner {
  if (provisionerKey === "t3code") return t3codeProvisioner;
  if (provisionerKey === "opencode") return opencodeProvisioner;
  throw new Error(`Unsupported agent provisioner: ${provisionerKey}`);
}
