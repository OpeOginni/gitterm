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
export type CreateInstanceResult =
  | { type: "workspace"; workspaceId: string; userId: string }
  | { type: "agent-loop" };

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

export interface RepoFile {
  path: string;
  name: string;
  size?: number;
}

export type RunMode = "automatic" | "manual";

// Model Provider types for Agentic Loops
export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  requiresApiKey?: boolean; // Defaults to true if not specified
}

export interface ModelProvider {
  id: string;
  name: string;
  models: ModelOption[];
}

// Available model providers and their models
export const MODEL_PROVIDERS: ModelProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    models: [
      {
        id: "claude-opus-4-5",
        name: "Claude Opus 4.5",
        description: "Most capable model",
        requiresApiKey: true,
      },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    models: [
      {
        id: "glm-4.7-free",
        name: "GLM 4.7 Free",
        description: "Free tier model",
        requiresApiKey: false,
      },
      {
        id: "gpt-5.2",
        name: "GPT 5.2",
        description: "Advanced reasoning",
        requiresApiKey: true,
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    models: [
      {
        id: "gpt-5.2",
        name: "GPT 5.2",
        description: "Standard model",
        requiresApiKey: true,
      },
      {
        id: "gpt-5.2-pro",
        name: "GPT 5.2 Pro",
        description: "Enhanced capabilities",
        requiresApiKey: true,
      },
    ],
  },
];

// Helper to get models for a provider
export function getModelsForProvider(providerId: string): ModelOption[] {
  const provider = MODEL_PROVIDERS.find((p) => p.id === providerId);
  return provider?.models ?? [];
}

// Helper to check if a model requires an API key
export function modelRequiresApiKey(providerId: string, modelId: string): boolean {
  const models = getModelsForProvider(providerId);
  const model = models.find((m) => m.id === modelId);
  return model?.requiresApiKey !== false; // Default to true
}

// Helper to get full model identifier (provider/model)
export function getFullModelId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export interface AgenticLoopConfig {
  installationId: string;
  repository: Repository | null;
  branch: string;
  planFile: RepoFile | null;
  documentationFile: RepoFile | null;
  runMode: RunMode;
  iterations: number;
  modelProvider: string;
  model: string;
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
  ralph: "/ralph-wiggum.svg",
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
  claude: "anthropic",
};

export const getModelProviderLogo = (providerKey: string): string | null => {
  const key = providerKey.toLowerCase();
  const file = MODEL_PROVIDER_LOGO_ALIASES[key] ?? key;
  if (!file) return null;
  return `/${file}.svg`;
};
