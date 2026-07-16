import type { AgentProvisioning } from "../../providers/compute";
import type { AgentProvisioner, AgentProvisionerContext, UserProviderCredential } from "./types";

export const OPENCODE_CONFIG_PATH = "~/.config/opencode/opencode.json";
export const OPENCODE_TUI_CONFIG_PATH = "~/.config/opencode/tui.json";
export const OPENCODE_AUTH_PATH = "~/.local/share/opencode/auth.json";

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
): string {
  const username = `Gitterm: ${userDisplayName}`;
  const config = { ...agentConfig };
  delete config.theme;

  return JSON.stringify(
    agentConfig
      ? { ...config, username }
      : { $schema: "https://opencode.ai/config.json", username },
  );
}

/**
 * OpenCode registers a project lazily on the first request scoped to a
 * directory, so a fresh workspace shows an empty project picker until the
 * user types the repo path. Polling `/project/current` for the repo dir once
 * the server is up persists the project, making it one click away. Basic auth
 * is sent unconditionally; the server ignores it when no password is set.
 */
export function buildOpencodeRegisterProjectCommand(port: number = OPENCODE_SERVE_PORT): string {
  return [
    // Only git checkouts should become projects; a bare workspace dir would
    // register OpenCode's synthetic "global" project instead.
    `[ -e .git ] || exit 0`,
    `i=0`,
    `while [ "$i" -lt 120 ]; do`,
    `  curl -sf -o /dev/null -u "opencode:$OPENCODE_SERVER_PASSWORD" -G --data-urlencode "directory=$PWD" "http://127.0.0.1:${port}/project/current" && exit 0`,
    `  i=$((i + 1))`,
    `  sleep 1`,
    `done`,
    `echo "gitterm: timed out registering opencode project" >&2`,
    `exit 1`,
  ].join("\n");
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

    return {
      files: [
        {
          path: OPENCODE_CONFIG_PATH,
          contentBase64: toBase64(
            buildOpencodeConfigJson(ctx.agentConfigs?.opencode, ctx.userDisplayName),
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
      ],
      env,
      serve: {
        command: `opencode serve --hostname 0.0.0.0 --port ${OPENCODE_SERVE_PORT}`,
        port: OPENCODE_SERVE_PORT,
        postStartCommand: buildOpencodeRegisterProjectCommand(),
      },
      usesServerPassword: true,
    };
  },
};
