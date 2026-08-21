import type { AgentProvisioning } from "../../providers/compute";
import type { ApiKeyCredential, OAuthCredential } from "../encryption";

export interface UserProviderCredential {
  /** Dashboard credential ID, or null for inline credentials that are never stored. */
  credentialId: string | null;
  providerName: string;
  logicalProviderKey: string;
  credential: ApiKeyCredential | OAuthCredential;
}

export type AgentConfigByKind = Partial<
  Record<"opencode" | "claude-code" | "codex", Record<string, unknown> | null>
>;

export interface AgentProvisionerContext {
  userId: string;
  userDisplayName: string;
  workspaceHostname: string;
  agentTypeName: string;
  serverOnly: boolean;
  agentConfigs?: AgentConfigByKind;
  serverPassword?: string;
  credentials: UserProviderCredential[];
  opencode?: {
    skills?: Array<{ name: string; content: string }>;
    plugins?: string[];
    /** Merged over the user's saved OpenCode config; request wins per key. */
    config?: Record<string, unknown>;
  };
}

export interface AgentProvisioner {
  key: string;
  provision(ctx: AgentProvisionerContext): AgentProvisioning;
}
