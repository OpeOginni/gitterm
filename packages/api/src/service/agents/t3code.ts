import type { AgentFile, AgentProvisioning } from "../../providers/compute";
import {
  buildOpencodeAuthJson,
  buildOpencodeConfigJson,
  buildOpencodeTuiConfigJson,
  OPENCODE_AUTH_PATH,
  OPENCODE_CONFIG_PATH,
  OPENCODE_TUI_CONFIG_PATH,
} from "./opencode";
import type { AgentProvisioner, AgentProvisionerContext, UserProviderCredential } from "./types";

export const T3_SERVE_PORT = 4096;
const CLAUDE_CREDENTIALS_PATH = "~/.claude/.credentials.json";
const CLAUDE_SETTINGS_PATH = "~/.claude/settings.json";
const CODEX_AUTH_PATH = "~/.codex/auth.json";
const CODEX_CONFIG_PATH = "~/.codex/config.json";
const CLAUDE_OAUTH_SCOPES = ["user:inference", "user:profile"];

export const T3_PAIRING_CREATE_COMMAND =
  `t3 auth pairing create --label gitterm --ttl 30d --json` +
  ` | node -e "let d='';process.stdin.on('data',(c)=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).credential))"`;

function toBase64(value: string): string {
  return Buffer.from(value).toString("base64");
}

function findCredential(
  credentials: UserProviderCredential[],
  providerName: string,
): UserProviderCredential | undefined {
  return credentials.find((cred) => cred.providerName === providerName);
}

export function buildClaudeCredentialsJson(oauth: {
  access?: string;
  refresh: string;
  expires?: number;
}): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: oauth.access,
      refreshToken: oauth.refresh,
      expiresAt: oauth.expires,
      scopes: CLAUDE_OAUTH_SCOPES,
    },
  });
}

export function buildCodexAuthJson(
  credential: UserProviderCredential["credential"],
  lastRefresh: string,
): string {
  if (credential.type === "api_key") {
    return JSON.stringify({ OPENAI_API_KEY: credential.apiKey });
  }

  return JSON.stringify({
    OPENAI_API_KEY: null,
    tokens: {
      access_token: credential.access,
      refresh_token: credential.refresh,
      account_id: credential.accountId,
    },
    last_refresh: lastRefresh,
  });
}

export const t3codeProvisioner: AgentProvisioner = {
  key: "t3code",
  provision(ctx: AgentProvisionerContext): AgentProvisioning {
    const files: AgentFile[] = [];
    const env: Record<string, string> = {};

    const anthropic = findCredential(ctx.credentials, "anthropic");
    if (anthropic) {
      if (anthropic.credential.type === "api_key") {
        env.ANTHROPIC_API_KEY = anthropic.credential.apiKey;
      } else {
        files.push({
          path: CLAUDE_CREDENTIALS_PATH,
          contentBase64: toBase64(buildClaudeCredentialsJson(anthropic.credential)),
        });
      }
    }

    const codex = findCredential(ctx.credentials, "openai-oauth");
    const openai = findCredential(ctx.credentials, "openai");
    const codexCredential = codex ?? openai;
    if (codexCredential) {
      files.push({
        path: CODEX_AUTH_PATH,
        contentBase64: toBase64(
          buildCodexAuthJson(codexCredential.credential, new Date().toISOString()),
        ),
      });
    }
    if (openai?.credential.type === "api_key") {
      env.OPENAI_API_KEY = openai.credential.apiKey;
    }

    files.push({
      path: OPENCODE_AUTH_PATH,
      contentBase64: toBase64(buildOpencodeAuthJson(ctx.credentials)),
    });
    files.push({
      path: OPENCODE_CONFIG_PATH,
      contentBase64: toBase64(
        buildOpencodeConfigJson(ctx.agentConfigs?.opencode, ctx.userDisplayName),
      ),
    });
    files.push({
      path: OPENCODE_TUI_CONFIG_PATH,
      contentBase64: toBase64(buildOpencodeTuiConfigJson(ctx.agentConfigs?.opencode)),
    });

    const claudeConfig = ctx.agentConfigs?.["claude-code"];
    if (claudeConfig) {
      files.push({
        path: CLAUDE_SETTINGS_PATH,
        contentBase64: toBase64(JSON.stringify(claudeConfig)),
      });
    }

    const codexConfig = ctx.agentConfigs?.codex;
    if (codexConfig) {
      files.push({
        path: CODEX_CONFIG_PATH,
        contentBase64: toBase64(JSON.stringify(codexConfig)),
      });
    }

    return {
      files,
      env,
      serve: {
        command: `t3 serve --host 0.0.0.0 --port ${T3_SERVE_PORT} --no-browser --auto-bootstrap-project-from-cwd`,
        port: T3_SERVE_PORT,
        accessCredentialCommand: T3_PAIRING_CREATE_COMMAND,
      },
      usesServerPassword: false,
    };
  },
};
