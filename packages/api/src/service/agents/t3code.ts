import type { AgentFile, AgentProvisioning } from "../../providers/compute";
import { AGENT_CAPABILITIES } from "@gitterm/schema/agent-capabilities";
import { stringify as stringifyToml } from "smol-toml";
import {
  buildOpencodeAuthJson,
  buildOpencodeConfigJson,
  buildOpencodeTuiConfigJson,
  buildGittermInstructions,
  OPENCODE_CONFIG_PATH,
  OPENCODE_GITTERM_INSTRUCTIONS_PATH,
  OPENCODE_TUI_CONFIG_PATH,
} from "./opencode";
import type { AgentProvisioner, AgentProvisionerContext, UserProviderCredential } from "./types";

export const T3_SERVE_PORT = 4096;
const CLAUDE_CREDENTIALS_PATH = "~/.claude/.credentials.json";
const CLAUDE_SETTINGS_PATH = "~/.claude/settings.json";
const CODEX_AUTH_PATH = "~/.codex/auth.json";
const CODEX_CONFIG_PATH = "~/.codex/config.toml";
/** T3 drives its own OpenCode 1.x CLI, which still reads credentials from auth.json. */
const T3_OPENCODE_AUTH_PATH = "~/.local/share/opencode/auth.json";
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
  const matches = credentials.filter((cred) => cred.providerName === providerName);
  return matches.find((cred) => cred.isDefault) ?? matches[0];
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
    return JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: credential.apiKey });
  }

  if (!credential.idToken || !credential.access) {
    throw new Error(
      "ChatGPT credentials for T3Code require an identity and access token. Reconnect the saved ChatGPT account in GitTerm, or use an OpenAI API key and sign in to ChatGPT in T3Code's provider settings.",
    );
  }

  return JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: credential.idToken,
      access_token: credential.access,
      refresh_token: credential.refresh,
      account_id: credential.accountId,
    },
    last_refresh: lastRefresh,
  });
}

export const t3codeProvisioner: AgentProvisioner = {
  key: "t3code",
  capabilities: AGENT_CAPABILITIES.t3code,
  accessCredentialCommand: T3_PAIRING_CREATE_COMMAND,
  provision(ctx: AgentProvisionerContext): AgentProvisioning {
    const files: AgentFile[] = [];
    const env: Record<string, string> = {};
    const instructions = buildGittermInstructions(ctx.additionalAgentInstructions);

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
    const codexCredential = [codex, openai].find((cred) => cred?.isDefault) ?? codex ?? openai;
    if (codexCredential) {
      files.push({
        path: CODEX_AUTH_PATH,
        contentBase64: toBase64(
          buildCodexAuthJson(codexCredential.credential, new Date().toISOString()),
        ),
      });
    }
    if (codexCredential?.credential.type === "api_key") {
      env.OPENAI_API_KEY = codexCredential.credential.apiKey;
    }

    files.push({
      path: T3_OPENCODE_AUTH_PATH,
      contentBase64: toBase64(buildOpencodeAuthJson(ctx.credentials)),
    });
    files.push({
      path: OPENCODE_CONFIG_PATH,
      contentBase64: toBase64(
        buildOpencodeConfigJson(
          ctx.opencode?.config
            ? { ...ctx.agentConfigs?.opencode, ...ctx.opencode.config }
            : ctx.agentConfigs?.opencode,
          ctx.userDisplayName,
          ctx.opencode?.plugins,
        ),
      ),
    });
    files.push({
      path: OPENCODE_TUI_CONFIG_PATH,
      contentBase64: toBase64(buildOpencodeTuiConfigJson(ctx.agentConfigs?.opencode)),
    });
    files.push({
      path: OPENCODE_GITTERM_INSTRUCTIONS_PATH,
      contentBase64: toBase64(instructions),
    });
    // Native global instruction locations; no repository files are overwritten.
    for (const path of ["~/.claude/CLAUDE.md", "~/.codex/AGENTS.md"]) {
      files.push({ path, contentBase64: toBase64(instructions) });
    }
    for (const skill of ctx.opencode?.skills ?? []) {
      files.push({
        path: `~/.config/opencode/skills/${skill.name}/SKILL.md`,
        contentBase64: toBase64(skill.content),
      });
      for (const root of ["~/.claude/skills", "~/.agents/skills"]) {
        files.push({
          path: `${root}/${skill.name}/SKILL.md`,
          contentBase64: toBase64(skill.content),
        });
      }
    }

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
        contentBase64: toBase64(stringifyToml(codexConfig)),
      });
    }

    return {
      files,
      env,
      serve: {
        command:
          `(printf 'PRETTY_HOSTNAME=%s\\n' '${ctx.workspaceHostname}'` +
          ` | sudo -n tee /etc/machine-info >/dev/null 2>&1 || true);` +
          ` exec t3 start --host 0.0.0.0 --port ${T3_SERVE_PORT} --no-browser --auto-bootstrap-project-from-cwd`,
        port: T3_SERVE_PORT,
        accessCredentialCommand: T3_PAIRING_CREATE_COMMAND,
      },
      usesServerPassword: false,
    };
  },
};
