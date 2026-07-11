import type { AgentProvisioning } from "../../providers/compute";
import type { AgentProvisioner, AgentProvisionerContext, UserProviderCredential } from "./types";

export const OPENCODE_CONFIG_PATH = "~/.config/opencode/opencode.json";
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

  return JSON.stringify(
    agentConfig
      ? { ...agentConfig, username }
      : { $schema: "https://opencode.ai/config.json", username },
  );
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
          path: OPENCODE_AUTH_PATH,
          contentBase64: toBase64(buildOpencodeAuthJson(ctx.credentials)),
        },
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
