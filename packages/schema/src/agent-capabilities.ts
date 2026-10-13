import type { AgentProvisionerKey } from "./workspace-catalog";

/** GitTerm capabilities, not the features exposed by an agent's own clients. */
export interface AgentCapabilities {
  access: "server-password" | "pairing";
  runs: boolean;
  mcpConnections: boolean;
  managedCredentialRefresh: boolean;
  configKinds: readonly ("opencode" | "claude-code" | "codex")[];
}

export const AGENT_CAPABILITIES: Record<AgentProvisionerKey, AgentCapabilities> = {
  opencode: {
    access: "server-password",
    runs: true,
    mcpConnections: true,
    managedCredentialRefresh: true,
    configKinds: ["opencode"],
  },
  t3code: {
    access: "pairing",
    runs: false,
    mcpConnections: false,
    managedCredentialRefresh: false,
    configKinds: ["opencode", "claude-code", "codex"],
  },
};

export function getAgentCapabilities(key: string): AgentCapabilities | undefined {
  return Object.hasOwn(AGENT_CAPABILITIES, key)
    ? AGENT_CAPABILITIES[key as AgentProvisionerKey]
    : undefined;
}

/** Legacy display-name compatibility only. Server decisions should use provisionerKey. */
export function agentProvisionerKeyForName(name: string): AgentProvisionerKey | undefined {
  const normalized = name.trim().toLowerCase();
  if (normalized.startsWith("t3code")) return "t3code";
  if (normalized.startsWith("opencode")) return "opencode";
  return undefined;
}
