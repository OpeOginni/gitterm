/**
 * Model providers users can save credentials for. Seeds the `model_provider`
 * table and describes the dashboard form for each provider.
 *
 * `logicalProviderKey` is the OpenCode integration ID. Several auth methods for
 * one integration (an API key and an OAuth subscription) share it, which is how
 * workspaces pick one credential per provider.
 */

export type ModelProviderAuthType = "api_key" | "oauth";

/** Non-secret value OpenCode needs next to the key, such as a Cloudflare account ID. */
export interface ModelProviderField {
  /** Key OpenCode reads from the credential's form answer. */
  key: string;
  label: string;
  placeholder?: string;
  pattern?: string;
  patternMessage?: string;
}

export interface ModelProviderDefinition {
  name: string;
  displayName: string;
  logicalProviderKey: string;
  authType: ModelProviderAuthType;
  /** OAuth flow implementation; null for API keys. */
  plugin: string | null;
  /**
   * The provider rotates refresh tokens, so copies in several workspaces would
   * invalidate each other. GitTerm keeps the refresh token and workspaces fetch
   * access tokens from it instead.
   */
  refreshedByGitterm?: boolean;
  isRecommended?: boolean;
  /** Listed first in the API key picker. */
  featured?: boolean;
  /** One line shown on OAuth account cards. */
  description?: string;
  /** Where to create a key or sign up. */
  keyUrl?: string;
  keyPlaceholder?: string;
  fields?: ModelProviderField[];
}

const CLOUDFLARE_ACCOUNT_ID: ModelProviderField = {
  key: "accountId",
  label: "Account ID",
  placeholder: "1234567890abcdef1234567890abcdef",
  pattern: "^[a-fA-F0-9]{32}$",
  patternMessage: "Cloudflare account IDs are 32 hexadecimal characters",
};

export const MODEL_PROVIDERS: readonly ModelProviderDefinition[] = [
  // ── OAuth accounts ──
  {
    name: "opencode-console",
    displayName: "OpenCode",
    logicalProviderKey: "opencode",
    authType: "oauth",
    plugin: "opencode-console",
    refreshedByGitterm: true,
    isRecommended: true,
    description: "Zen and Go through your OpenCode console account.",
    keyUrl: "https://opencode.ai/auth",
  },
  {
    name: "openai-oauth",
    displayName: "ChatGPT",
    logicalProviderKey: "openai",
    authType: "oauth",
    plugin: "oauth",
    refreshedByGitterm: true,
    isRecommended: true,
    description: "Use your ChatGPT Plus or Pro subscription.",
  },
  {
    name: "github-copilot",
    displayName: "GitHub Copilot",
    logicalProviderKey: "github-copilot",
    authType: "oauth",
    plugin: "copilot-auth",
    description: "Use the models in your Copilot plan.",
  },
  {
    name: "xai-oauth",
    displayName: "SuperGrok",
    logicalProviderKey: "xai",
    authType: "oauth",
    plugin: "xai-oauth",
    refreshedByGitterm: true,
    description: "Use Grok models from your SuperGrok subscription.",
  },

  // ── API keys ──
  {
    name: "opencode",
    displayName: "OpenCode Zen",
    logicalProviderKey: "opencode",
    authType: "api_key",
    plugin: null,
    isRecommended: true,
    featured: true,
    keyUrl: "https://opencode.ai/auth",
  },
  // Separate OpenCode provider ID (`opencode-go`); a Zen key does not select Go models.
  {
    name: "opencode-go",
    displayName: "OpenCode Go",
    logicalProviderKey: "opencode-go",
    authType: "api_key",
    plugin: null,
    isRecommended: true,
    featured: true,
    keyUrl: "https://opencode.ai/auth",
  },
  {
    name: "anthropic",
    displayName: "Anthropic",
    logicalProviderKey: "anthropic",
    authType: "api_key",
    plugin: null,
    featured: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-...",
  },
  {
    name: "openai",
    displayName: "OpenAI",
    logicalProviderKey: "openai",
    authType: "api_key",
    plugin: null,
    featured: true,
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-...",
  },
  {
    name: "google",
    displayName: "Google AI",
    logicalProviderKey: "google",
    authType: "api_key",
    plugin: null,
    featured: true,
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    name: "openrouter",
    displayName: "OpenRouter",
    logicalProviderKey: "openrouter",
    authType: "api_key",
    plugin: null,
    featured: true,
    keyUrl: "https://openrouter.ai/settings/keys",
    keyPlaceholder: "sk-or-...",
  },
  {
    name: "xai",
    displayName: "xAI",
    logicalProviderKey: "xai",
    authType: "api_key",
    plugin: null,
    featured: true,
    keyUrl: "https://console.x.ai",
    keyPlaceholder: "xai-...",
  },
  {
    name: "azure",
    displayName: "Azure OpenAI",
    logicalProviderKey: "azure",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://portal.azure.com",
    fields: [{ key: "resourceName", label: "Resource name", placeholder: "my-models" }],
  },
  {
    name: "cerebras",
    displayName: "Cerebras",
    logicalProviderKey: "cerebras",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://cloud.cerebras.ai",
  },
  {
    name: "cloudflare-ai-gateway",
    displayName: "Cloudflare AI Gateway",
    logicalProviderKey: "cloudflare-ai-gateway",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    fields: [
      CLOUDFLARE_ACCOUNT_ID,
      { key: "gatewayId", label: "Gateway ID", placeholder: "my-gateway" },
    ],
  },
  {
    name: "cloudflare-workers-ai",
    displayName: "Cloudflare Workers AI",
    logicalProviderKey: "cloudflare-workers-ai",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    fields: [CLOUDFLARE_ACCOUNT_ID],
  },
  {
    name: "deepinfra",
    displayName: "Deep Infra",
    logicalProviderKey: "deepinfra",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://deepinfra.com/dash/api_keys",
  },
  {
    name: "deepseek",
    displayName: "DeepSeek",
    logicalProviderKey: "deepseek",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyPlaceholder: "sk-...",
  },
  {
    name: "fireworks-ai",
    displayName: "Fireworks AI",
    logicalProviderKey: "fireworks-ai",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://fireworks.ai/account/api-keys",
    keyPlaceholder: "fw_...",
  },
  {
    name: "groq",
    displayName: "Groq",
    logicalProviderKey: "groq",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_...",
  },
  {
    name: "huggingface",
    displayName: "Hugging Face",
    logicalProviderKey: "huggingface",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://huggingface.co/settings/tokens",
    keyPlaceholder: "hf_...",
  },
  {
    name: "minimax",
    displayName: "MiniMax",
    logicalProviderKey: "minimax",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
  },
  {
    name: "mistral",
    displayName: "Mistral",
    logicalProviderKey: "mistral",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://console.mistral.ai/api-keys",
  },
  {
    name: "moonshotai",
    displayName: "Moonshot AI",
    logicalProviderKey: "moonshotai",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
    keyPlaceholder: "sk-...",
  },
  {
    name: "nvidia",
    displayName: "NVIDIA",
    logicalProviderKey: "nvidia",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://build.nvidia.com/settings/api-keys",
    keyPlaceholder: "nvapi-...",
  },
  {
    name: "perplexity",
    displayName: "Perplexity",
    logicalProviderKey: "perplexity",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://www.perplexity.ai/settings/api",
    keyPlaceholder: "pplx-...",
  },
  {
    name: "togetherai",
    displayName: "Together AI",
    logicalProviderKey: "togetherai",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://api.together.ai/settings/api-keys",
  },
  {
    name: "vercel",
    displayName: "Vercel AI Gateway",
    logicalProviderKey: "vercel",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://vercel.com/docs/ai-gateway/authentication",
  },
  {
    name: "zai",
    displayName: "Z.AI",
    logicalProviderKey: "zai",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
  },
  {
    name: "zai-coding-plan",
    displayName: "Z.AI Coding Plan",
    logicalProviderKey: "zai-coding-plan",
    authType: "api_key",
    plugin: null,
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
  },
];

const BY_NAME = new Map(MODEL_PROVIDERS.map((provider) => [provider.name, provider]));

export function getModelProviderDefinition(name: string): ModelProviderDefinition | undefined {
  return BY_NAME.get(name);
}

export function modelProviderRequiresFields(name: string): boolean {
  return (BY_NAME.get(name)?.fields?.length ?? 0) > 0;
}

/**
 * Validates the extra values an API key needs and returns them trimmed.
 * Unknown keys are rejected so arbitrary data cannot ride along into the workspace.
 */
export function normalizeModelProviderFields(
  name: string,
  values: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const fields = BY_NAME.get(name)?.fields ?? [];
  const input = values ?? {};
  const allowed = new Set(fields.map((field) => field.key));
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new Error(`Unexpected fields for ${name}: ${unknown.join(", ")}`);
  }
  if (!fields.length) return undefined;

  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = input[field.key]?.trim() ?? "";
    if (!value) throw new Error(`${field.label} is required`);
    if (value.length > 200) throw new Error(`${field.label} is too long`);
    if (field.pattern && !new RegExp(field.pattern).test(value)) {
      throw new Error(field.patternMessage ?? `${field.label} is invalid`);
    }
    result[field.key] = value;
  }
  return result;
}
