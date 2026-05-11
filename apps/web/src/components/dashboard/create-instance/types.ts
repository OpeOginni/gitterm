export type WorkspaceType = "cloud" | "agentic-loops";
export type WorkspaceProfile = "standard" | "ssh-enabled";
export type EditorTarget = "vscode" | "neovim";
export type EditorTransportKind = "direct-ssh" | "proxycommand-ssh" | "managed-ssh";

export interface EditorAccessSupport {
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
  serverOnly: boolean;
}

export interface CloudProvider {
  id: string;
  name: string;
  providerKey: string;
  supportsRegions: boolean;
  allowUserRegionSelection: boolean;
  regions?: Region[];
  editorAccessSupport?: EditorAccessSupport;
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
      { id: "gpt-5.2", name: "GPT 5.2", description: "Advanced reasoning", requiresApiKey: true },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    models: [
      { id: "gpt-5.2", name: "GPT 5.2", description: "Standard model", requiresApiKey: true },
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
  opencode: "/opencode.svg",
  shuvcode: "/opencode.svg",
  railway: "/railway.svg",
  cloudflare: "/cloudflare.svg",
  e2b: "/E2B.svg",
  daytona: "/daytona.svg",
  aws: "/ECS.svg",
  claude: "/code.svg",
  ralph: "/ralph-wiggum.svg",
};

export const getIcon = (name: string): string => {
  const key = name.toLowerCase();
  for (const [k, v] of Object.entries(ICON_MAP)) {
    if (key.includes(k)) return v;
  }
  return "/opencode.svg";
};
