import type { AgentProvisioning } from "../../providers/compute";
import type { ApiKeyCredential, OAuthCredential } from "../encryption";

export interface UserProviderCredential {
  providerName: string;
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
  };
}

export interface AgentProvisioner {
  key: string;
  provision(ctx: AgentProvisionerContext): AgentProvisioning;
}
