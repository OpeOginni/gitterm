import env from "@gitterm/env/web";
import { apiPath } from "@gitterm/schema/url";
import type { ApiTokenScope } from "@gitterm/schema";

export type Platform = "slack" | "discord";

/** Exactly what a bot needs: find and create its sandboxes, run prompts, and list connections. */
export const BOT_TOKEN_SCOPES: ApiTokenScope[] = [
  "identity:read",
  "workspace:read",
  "workspace:write",
  "run:read",
  "run:write",
  "integrations:read",
];

const SUGGESTED_MODELS: Record<string, string> = {
  anthropic: "anthropic/claude-sonnet-4-5",
  openai: "openai/gpt-5",
  google: "google/gemini-2.5-pro",
  opencode: "opencode/big-pickle",
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

/** Quote a .env value only when it needs it. */
const envValue = (value: string) => (/[\s#"'\\]/.test(value) ? JSON.stringify(value) : value);

export type BotConfig = {
  platform: Platform;
  token: string;
  repo: string;
  model: string;
  /** Saved credential label; only when it isn't the provider's default. */
  credential?: string;
  connections: string[];
};

export function envFile(config: BotConfig): string {
  const serverUrl = botServerUrl();
  const lines = [
    ...(serverUrl ? [`GITTERM_SERVER_URL=${serverUrl}`] : []),
    `GITTERM_API_TOKEN=${config.token}`,
    `GITTERM_BOT_REPO=${envValue(config.repo)}`,
    `GITTERM_BOT_MODEL=${envValue(config.model)}`,
    ...(config.credential ? [`GITTERM_BOT_MODEL_CREDENTIAL=${envValue(config.credential)}`] : []),
    ...(config.connections.length
      ? [`GITTERM_BOT_CONNECTIONS=${envValue(config.connections.join(","))}`]
      : []),
    "",
    ...(config.platform === "slack"
      ? [
          "# OAuth & Permissions → Bot User OAuth Token (xoxb-…)",
          "SLACK_BOT_TOKEN=",
          "# Basic Information → App-Level Tokens, scope connections:write (xapp-…)",
          "SLACK_APP_TOKEN=",
        ]
      : ["# Developer portal → your app → Bot → Reset Token", "DISCORD_BOT_TOKEN="]),
  ];
  return `${lines.join("\n")}\n`;
}

export function codeSnippet(config: BotConfig): string {
  const factory = config.platform === "slack" ? "createSlackBot" : "createDiscordBot";
  const model = config.credential
    ? `{ id: ${JSON.stringify(config.model)}, credential: ${JSON.stringify(config.credential)} }`
    : JSON.stringify(config.model);
  const options = [
    `  repo: ${JSON.stringify(config.repo)},`,
    `  model: ${model},`,
    ...(config.connections.length
      ? [`  connections: [${config.connections.map((ref) => JSON.stringify(ref)).join(", ")}],`]
      : []),
  ];
  return [
    `import { ${factory} } from "@gitterm/${config.platform}-bot";`,
    "",
    "// Tokens are read from the .env above.",
    `await ${factory}({`,
    ...options,
    "}).start();",
    "",
  ].join("\n");
}
