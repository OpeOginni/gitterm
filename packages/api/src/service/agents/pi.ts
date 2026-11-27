import { PI_EXTENSION, PI_EXTENSION_PATH, PI_TERMINAL } from "@gitterm/schema/pi";
import { terminalFiles, terminalServeCommand, TERMINAL_PASSWORD_ENV } from "../terminal";
import { AGENT_CAPABILITIES } from "@gitterm/schema/agent-capabilities";
import type { AgentFile, AgentProvisioning } from "../../providers/compute";
import { buildGittermInstructions } from "./opencode";
import type { AgentProvisioner, UserProviderCredential } from "./types";

export const PI_SERVE_PORT = 4096;
const AGENT_DIR = "~/.pi/agent";

/** GitTerm model providers whose Pi provider id differs. Others keep their name. */
const PI_PROVIDER_IDS: Record<string, string> = {
  "openai-oauth": "openai-codex",
  "xai-oauth": "xai",
};

/** Pi's `auth.json`: one credential per Pi provider, the default account where there are several. */
export function buildPiAuth(credentials: UserProviderCredential[]): Record<string, unknown> {
  const auth: Record<string, unknown> = {};
  const ordered = [...credentials].sort((a, b) => Number(a.isDefault) - Number(b.isDefault));
  for (const { providerName, credential } of ordered) {
    const id = PI_PROVIDER_IDS[providerName] ?? providerName;
    auth[id] =
      credential.type === "api_key"
        ? { type: "api_key", key: credential.apiKey }
        : {
            type: "oauth",
            refresh: credential.refresh,
            access: credential.access ?? "",
            expires: credential.expires ?? 0,
            ...(credential.accountId ? { accountId: credential.accountId } : {}),
            ...(credential.enterpriseUrl ? { enterpriseUrl: credential.enterpriseUrl } : {}),
          };
  }
  return auth;
}

const file = (path: string, content: string, mode?: 0o600): AgentFile => ({
  path: `${AGENT_DIR}/${path}`,
  contentBase64: Buffer.from(content).toString("base64"),
  ...(mode ? { mode } : {}),
});

/**
 * Pi in GitTerm's browser terminal. Its files are its own: model credentials in `auth.json` (Pi
 * refreshes OAuth tokens and writes them back), GitTerm's instructions in `AGENTS.md`, skills,
 * and the GitTerm extension that delivers a moved session's notice.
 */
export const piProvisioner: AgentProvisioner = {
  key: "pi",
  capabilities: AGENT_CAPABILITIES.pi,
  provision(ctx): AgentProvisioning {
    const files: AgentFile[] = [
      file("auth.json", JSON.stringify(buildPiAuth(ctx.credentials), null, 2), 0o600),
      // Project skills and settings load without asking, as the workspace is the user's.
      file("settings.json", JSON.stringify({ defaultProjectTrust: "always" }, null, 2)),
      file("AGENTS.md", buildGittermInstructions(ctx.additionalAgentInstructions)),
      file(PI_EXTENSION_PATH, PI_EXTENSION),
      ...(ctx.opencode?.skills ?? []).map((skill) =>
        file(`skills/${skill.name}/SKILL.md`, skill.content),
      ),
      ...terminalFiles(),
    ];
    return {
      files,
      env: {
        ...(ctx.serverPassword ? { [TERMINAL_PASSWORD_ENV]: ctx.serverPassword } : {}),
        PI_TELEMETRY: "0",
        PI_SKIP_VERSION_CHECK: "1",
      },
      serve: { command: terminalServeCommand(PI_SERVE_PORT, PI_TERMINAL), port: PI_SERVE_PORT },
      usesServerPassword: true,
    };
  },
};
