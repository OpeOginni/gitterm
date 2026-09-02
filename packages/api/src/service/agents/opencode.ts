import type { AgentProvisioning } from "../../providers/compute";
import type { AgentProvisioner, AgentProvisionerContext, UserProviderCredential } from "./types";

export const OPENCODE_CONFIG_PATH = "~/.config/opencode/opencode.json";
export const OPENCODE_TUI_CONFIG_PATH = "~/.config/opencode/tui.json";
export const OPENCODE_AUTH_PATH = "~/.local/share/opencode/auth.json";
export const OPENCODE_GITTERM_INSTRUCTIONS_PATH = "~/.config/opencode/AGENTS.md";

const OPENCODE_SERVE_PORT = 4096;

function toBase64(value: string): string {
  return Buffer.from(value).toString("base64");
}

export function buildOpencodeAuthJson(credentials: UserProviderCredential[]): string {
  const entries = credentials.map((cred) => {
    const providerName = cred.providerName === "openai-oauth" ? "openai" : cred.providerName;

    return [
      providerName,
      {
        type: cred.credential.type === "api_key" ? "api" : "oauth",
        key: cred.credential.type === "api_key" ? cred.credential.apiKey : undefined,
        refresh: cred.credential.type === "oauth" ? cred.credential.refresh : undefined,
        access: cred.credential.type === "oauth" ? cred.credential.access : undefined,
        expires: cred.credential.type === "oauth" ? cred.credential.expires : undefined,
        accountId: cred.credential.type === "oauth" ? cred.credential.accountId : undefined,
      },
    ] as const;
  });

  return JSON.stringify(Object.fromEntries(entries));
}

export function buildOpencodeConfigJson(
  agentConfig: Record<string, unknown> | null | undefined,
  userDisplayName: string,
  plugins: string[] = [],
): string {
  const username = `Gitterm: ${userDisplayName}`;
  const config = { ...agentConfig };
  delete config.theme;
  const configuredPlugins = Array.isArray(config.plugin) ? config.plugin : [];
  const configuredPluginNames = new Set(
    configuredPlugins.filter((plugin): plugin is string => typeof plugin === "string"),
  );
  const plugin = [
    ...configuredPlugins,
    ...plugins.filter((pluginName) => !configuredPluginNames.has(pluginName)),
  ];

  return JSON.stringify(
    agentConfig
      ? { ...config, username, ...(plugin.length > 0 ? { plugin } : {}) }
      : {
          $schema: "https://opencode.ai/config.json",
          username,
          ...(plugin.length > 0 ? { plugin } : {}),
        },
  );
}

export const GITTERM_INSTRUCTIONS = `You are running inside a GitTerm workspace.

The gitterm CLI can inspect and operate only this workspace:
- gitterm workspace info
- gitterm ports list
- gitterm ports open <port> [--name <name>]
- gitterm ports close <port>

Follow the user's instructions for branches, commits, pull requests, ports, uploads, and cleanup.
Do not assume a requested product outcome succeeded only because an agent run completed.
`;

export function buildGittermInstructions(additional?: string): string {
  const trimmed = additional?.trim();
  return trimmed ? `${GITTERM_INSTRUCTIONS}\n${trimmed}\n` : GITTERM_INSTRUCTIONS;
}

export function buildAwsRuntimeInstructions(input: {
  region: string;
  location?: string;
  taskRoleArn?: string;
}): string {
  const location = input.location?.trim();
  const role = input.taskRoleArn?.trim();
  const roleName = role?.split("/").at(-1);
  return `AWS runtime:
- Compute: AWS ECS in \`${input.region}\`${location ? ` (${location})` : ""}. AWS commands default to this region.
- Identity: temporary ECS task-role credentials${role ? ` for \`${role}\`` : ""}; never print, copy, or replace them with static keys.
- Permission discovery:${roleName ? ` inspect attached and inline policies for role \`${roleName}\` with the AWS IAM CLI before making AWS changes;` : " inspect the current task role's attached and inline policies before making AWS changes;"} read only policy documents relevant to the task. Do not assume administrator access.
- If access is denied, report the exact action and resource and ask for that permission instead of retrying, changing regions, or bypassing the role.`;
}

export function buildOpencodeTuiConfigJson(
  agentConfig: Record<string, unknown> | null | undefined,
): string {
  return JSON.stringify({
    $schema: "https://opencode.ai/tui.json",
    theme: typeof agentConfig?.theme === "string" ? agentConfig.theme : "opencode",
  });
}

export const opencodeProvisioner: AgentProvisioner = {
  key: "opencode",
  provision(ctx: AgentProvisionerContext): AgentProvisioning {
    const env: Record<string, string> = {};
    if (ctx.serverPassword) {
      env.OPENCODE_SERVER_PASSWORD = ctx.serverPassword;
    }

    const opencodeConfig = ctx.opencode?.config
      ? { ...ctx.agentConfigs?.opencode, ...ctx.opencode.config }
      : ctx.agentConfigs?.opencode;

    return {
      files: [
        {
          path: OPENCODE_CONFIG_PATH,
          contentBase64: toBase64(
            buildOpencodeConfigJson(opencodeConfig, ctx.userDisplayName, ctx.opencode?.plugins),
          ),
        },
        {
          path: OPENCODE_TUI_CONFIG_PATH,
          contentBase64: toBase64(buildOpencodeTuiConfigJson(ctx.agentConfigs?.opencode)),
        },
        {
          path: OPENCODE_AUTH_PATH,
          contentBase64: toBase64(buildOpencodeAuthJson(ctx.credentials)),
        },
        {
          path: OPENCODE_GITTERM_INSTRUCTIONS_PATH,
          contentBase64: toBase64(buildGittermInstructions(ctx.additionalAgentInstructions)),
        },
        ...(ctx.opencode?.skills ?? []).map((skill) => ({
          path: `~/.config/opencode/skills/${skill.name}/SKILL.md`,
          contentBase64: toBase64(skill.content),
        })),
      ],
      env,
      serve: {
        command: `opencode serve --hostname 0.0.0.0 --port ${OPENCODE_SERVE_PORT}`,
        port: OPENCODE_SERVE_PORT,
      },
      usesServerPassword: true,
    };
  },
};
