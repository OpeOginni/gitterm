import env from "@gitterm/env/web";
import { apiPath } from "@gitterm/schema/url";

export type Platform = "slack" | "discord";

/** A current coding model per provider (models.dev IDs), so the default isn't a stale one. */
const SUGGESTED_MODELS: Record<string, string> = {
  anthropic: "anthropic/claude-sonnet-5-5",
  openai: "openai/gpt-6.1-sol",
  google: "google/gemini-3.8-flash",
  opencode: "opencode/deepseek-v4-pro",
  "opencode-go": "opencode-go/deepseek-v4-pro",
  "github-copilot": "github-copilot/claude-sonnet-5.5",
  openrouter: "openrouter/anthropic/claude-sonnet-5.5",
  xai: "xai/grok-4.7",
  deepseek: "deepseek/deepseek-v4-pro",
  moonshotai: "moonshotai/kimi-k3",
  zai: "zai/glm-5.3",
  "zai-coding-plan": "zai-coding-plan/glm-5.3",
  minimax: "minimax/MiniMax-M3",
};

export function suggestModel(provider: string | undefined): string {
  if (!provider) return "";
  return SUGGESTED_MODELS[provider] ?? `${provider}/`;
}

/** The model's problem, if any, given the credential's provider key. */
export function modelProblem(model: string, provider: string | undefined): string | null {
  const [prefix, ...rest] = model.trim().split("/");
  if (!prefix || !rest.join("/")) return "Enter a model ID like provider/model.";
  if (provider && prefix !== provider)
    return `Start the model ID with ${provider}/ to use this key.`;
  return null;
}

const HOSTED_SERVER_URL = "https://api.gitterm.dev";
const apiBase = (base: string) => apiPath(base, "").replace(/\/+$/, "");

/**
 * The SDK's server URL for this deployment: the API base under /api (same rule as the auth
 * client's `apiPath`; the server serves tRPC at both /trpc and /api/trpc). Null on the hosted
 * deployment, which is the SDK's default.
 */
export function botServerUrl(): string | null {
  const base = env.NEXT_PUBLIC_SERVER_URL?.trim();
  if (!base) return null;
  const url = apiBase(base);
  return url === apiBase(HOSTED_SERVER_URL) ? null : url;
}

type NamedConnection = { id: string; name: string };

// The server reads these references as integration keys before names.
const INTEGRATION_KEYS = ["github", "google", "gitlab", "bitbucket", "mcp", "executor"];

/** A connection's name when it alone identifies it (and survives a comma list), else its id. */
export function connectionRefs(selected: NamedConnection[], all: NamedConnection[]): string[] {
  return selected.map((connection) => {
    const name = connection.name.trim();
    const unique =
      all.filter((other) => other.name.trim().toLowerCase() === name.toLowerCase()).length === 1;
    const safe = name && !/[,#"'\n]/.test(name) && !INTEGRATION_KEYS.includes(name.toLowerCase());
    return unique && safe ? name : connection.id;
  });
}

/** What the .env needs: secrets only. The bot reads its settings from GitTerm. */
export type BotEnv = {
  platform: Platform;
  /** The bot's GitTerm token; null once it's no longer shown (it is shown once). */
  token: string | null;
  /** The bot brings its own GitHub token. */
  githubToken: boolean;
};

export function envFile(config: BotEnv): string {
  const serverUrl = botServerUrl();
  const lines = [
    ...(serverUrl ? [`GITTERM_SERVER_URL=${serverUrl}`] : []),
    ...(config.token
      ? [`GITTERM_API_TOKEN=${config.token}`]
      : ["# The bot's GitTerm token. Lost it? New token on this page.", "GITTERM_API_TOKEN="]),
    ...(config.githubToken
      ? [
          "",
          "# Your GitHub token, with read and write access to the repository",
          "GITTERM_BOT_GITHUB_TOKEN=",
        ]
      : []),
    "",
    ...(config.platform === "slack"
      ? [
          "# OAuth & Permissions → Bot User OAuth Token (xoxb-…)",
          "SLACK_BOT_TOKEN=",
          "# Basic Information → App-Level Tokens (xapp-…)",
          "SLACK_APP_TOKEN=",
        ]
      : ["# Developer portal → your app → Bot → Reset Token", "DISCORD_BOT_TOKEN="]),
  ];
  return `${lines.join("\n")}\n`;
}

/** One image runs either bot; it picks the platform from the token in the .env. */
export const BOT_IMAGE = "ghcr.io/opeoginni/gitterm-bot";

/** Mounts the .env (Docker's --env-file doesn't read dotenv quoting) and keeps state in a volume. */
export function dockerCommand(platform: Platform): string {
  const name = `gitterm-${platform}-bot`;
  return [
    `docker run -d --name ${name} --restart unless-stopped \\`,
    `  -v "$PWD/.env:/data/.env:ro" -v ${name}:/data \\`,
    `  ${BOT_IMAGE}`,
  ].join("\n");
}

export function codeSnippet(platform: Platform): string {
  const factory = platform === "slack" ? "createSlackBot" : "createDiscordBot";
  return [
    `import { ${factory}, withSavedConfig } from "@gitterm/${platform}-bot";`,
    "",
    "// Settings load from GitTerm; pass options to override them.",
    `const bot = ${factory}(await withSavedConfig());`,
    "await bot.start();",
    "",
  ].join("\n");
}
