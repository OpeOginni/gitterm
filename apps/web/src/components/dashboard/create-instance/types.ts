export type WorkspaceProfile = "standard" | "ssh-enabled";
export type EditorTarget = "vscode" | "neovim";
export type EditorTransportKind = "direct-ssh" | "proxycommand-ssh" | "managed-ssh";

export interface sshAccessSupport {
  supported: boolean;
  transportKind?: EditorTransportKind;
  label: string;
  description: string;
  requiresLocalBinaries?: string[];
}

// Result types for form submissions
export type CreateInstanceResult = { type: "workspace"; workspaceId: string; userId: string };

export interface CreateInstanceFormProps {
  onSuccess: (result: CreateInstanceResult) => void;
  onCancel: () => void;
}

export interface AgentType {
  id: string;
  name: string;
  description?: string | null;
  serverOnly: boolean;
}

export interface CloudProvider {
  id: string;
  name: string;
  providerKey: string;
  supportsRegions: boolean;
  allowUserRegionSelection: boolean;
  autoPersistent?: boolean;
  supportsPersistence?: boolean;
  regions?: Region[];
  machineProfiles?: MachineProfile[];
  awsAccessProfiles?: Array<{ id: string; name: string; description: string; roleArn: string }>;
  sshAccessSupport?: sshAccessSupport;
}

export interface MachineProfile {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
}

export interface Region {
  id: string;
  name: string;
}

export interface GitInstallation {
  git_integration: {
    id: string;
    providerAccountLogin: string;
    providerInstallationId: string;
  };
}

export interface SubdomainPermissions {
  canUseCustomCloudSubdomain: boolean;
}

export interface Repository {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  pushedAt?: string | null;
}

export interface Branch {
  name: string;
  protected: boolean;
}

export interface ResolvedGitHubRepository {
  owner: string;
  repo: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

export const ICON_MAP: Record<string, string> = {
  t3code: "/t3.svg",
  opencode: "/opencode.svg",
  shuvcode: "/opencode.svg",
  railway: "/railway.svg",
  cloudflare: "/cloudflare.svg",
  e2b: "/E2B.svg",
  daytona: "/daytona.svg",
  ascii: "/ascii.svg",
  "exe.dev": "/exe.png",
  exedev: "/exe.png",
  vercel: "/vercel.svg",
  aws: "/ECS.svg",
  claude: "/claude.svg",
};

const ICON_ENTRIES = Object.entries(ICON_MAP).sort((a, b) => b[0].length - a[0].length);

export const getIcon = (name: string): string => {
  const key = name.toLowerCase();
  for (const [k, v] of ICON_ENTRIES) {
    if (key.includes(k)) return v;
  }
  return "/opencode.svg";
};

/**
 * Logo for a *model* provider (Anthropic, OpenAI, …). Files in /public are
 * named after the provider key; OAuth variants share the base provider's mark.
 * Returns null when we know there is no artwork so callers can fall back.
 */
const MODEL_PROVIDER_LOGO_ALIASES: Record<string, string> = {
  "openai-oauth": "openai",
  "openai-codex": "openai-codex",
  "github-copilot": "github-copilot",
  "opencode-console": "opencode",
  "xai-oauth": "xai",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "cloudflare",
  claude: "anthropic",
};

export const getModelProviderLogo = (providerKey: string): string | null => {
  const key = providerKey.toLowerCase();
  const file = MODEL_PROVIDER_LOGO_ALIASES[key] ?? key;
  if (!file) return null;
  return `/${file}.svg`;
};
