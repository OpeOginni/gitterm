import { expect, test } from "bun:test";
import { parse as parseToml } from "smol-toml";
import { buildClaudeCredentialsJson, buildCodexAuthJson, t3codeProvisioner } from "./t3code";
import type { AgentProvisionerContext, UserProviderCredential } from "./types";
import type { AgentProvisioning } from "../../providers/compute";

const context: AgentProvisionerContext = {
  userId: "user",
  userDisplayName: "User",
  workspaceHostname: "ws.gitterm.dev",
  agentTypeName: "T3Code",
  serverOnly: true,
  credentials: [],
};

test("T3 starts with project registration instead of serve's forced headless defaults", () => {
  const command = t3codeProvisioner.provision(context).serve!.command;
  expect(command).toContain('exec node "$HOME/.gitterm/t3-origin-bridge.cjs" t3 start');
  expect(command).toContain("--no-browser --auto-bootstrap-project-from-cwd");
  expect(command).not.toContain("t3 serve");
});

function content(payload: AgentProvisioning, path: string): string {
  const file = payload.files.find((entry) => entry.path === path);
  expect(file).toBeDefined();
  return Buffer.from(file!.contentBase64, "base64").toString();
}

function credential(
  providerName: string,
  apiKey: string,
  isDefault = true,
): UserProviderCredential {
  return {
    credentialId: providerName,
    providerName,
    logicalProviderKey: providerName === "openai-oauth" ? "openai" : providerName,
    label: "default",
    isDefault,
    credential: { type: "api_key", apiKey },
  };
}

test("Codex settings are valid native TOML, including nested tables and escaped strings", () => {
  const codex = {
    model: "gpt-5-codex",
    approval_policy: "on-request",
    features: { multi_agent: true },
    mcp_servers: { example: { command: "node", args: ["a\\b", 'a"b'], env: { KEY: "value" } } },
  };
  const payload = t3codeProvisioner.provision({ ...context, agentConfigs: { codex } });
  expect(parseToml(content(payload, "~/.codex/config.toml"))).toEqual(codex);
  expect(payload.files.some((file) => file.path === "~/.codex/config.json")).toBe(false);
});

test("all three native backends receive global instructions and skills", () => {
  const payload = t3codeProvisioner.provision({
    ...context,
    additionalAgentInstructions: "AWS task role is scoped; do not broaden it.",
    opencode: { skills: [{ name: "testing", content: "# Test skill" }] },
  });
  for (const path of [
    "~/.config/opencode/AGENTS.md",
    "~/.claude/CLAUDE.md",
    "~/.codex/AGENTS.md",
  ]) {
    expect(content(payload, path)).toContain("gitterm workspace info");
    expect(content(payload, path)).toContain("AWS task role is scoped");
  }
  for (const root of ["~/.config/opencode/skills", "~/.claude/skills", "~/.agents/skills"]) {
    expect(content(payload, `${root}/testing/SKILL.md`)).toBe("# Test skill");
  }
  expect(payload.files.some((file) => file.relativeToRepo)).toBe(false);
});

test("request OpenCode config overrides saved config inside T3", () => {
  const payload = t3codeProvisioner.provision({
    ...context,
    agentConfigs: { opencode: { model: "old/model", theme: "dark", plugin: ["saved"] } },
    opencode: { config: { model: "new/model" }, plugins: ["extra"] },
  });
  expect(JSON.parse(content(payload, "~/.config/opencode/opencode.json"))).toMatchObject({
    model: "new/model",
    plugin: ["saved", "extra"],
  });
});

test("API keys reach native Claude and Codex, preferring the selected default", () => {
  const payload = t3codeProvisioner.provision({
    ...context,
    credentials: [
      credential("anthropic", "old", false),
      credential("anthropic", "selected"),
      credential("openai", "openai-key"),
    ],
  });
  expect(payload.env).toEqual({ ANTHROPIC_API_KEY: "selected", OPENAI_API_KEY: "openai-key" });
  expect(JSON.parse(content(payload, "~/.codex/auth.json"))).toEqual({
    auth_mode: "apikey",
    OPENAI_API_KEY: "openai-key",
  });
});

test("ChatGPT auth includes identity token and does not get overridden by the OpenAI API key", () => {
  const oauth = {
    type: "oauth" as const,
    refresh: "refresh",
    access: "access",
    idToken: "identity",
    accountId: "account",
  };
  const payload = t3codeProvisioner.provision({
    ...context,
    credentials: [
      { ...credential("openai-oauth", ""), credential: oauth },
      credential("openai", "api-key", false),
    ],
  });
  expect(JSON.parse(content(payload, "~/.codex/auth.json"))).toMatchObject({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: "identity",
      access_token: "access",
      refresh_token: "refresh",
      account_id: "account",
    },
  });
  expect(payload.env.OPENAI_API_KEY).toBeUndefined();
  expect(JSON.parse(buildCodexAuthJson(oauth, "2026-10-13T00:00:00Z")).last_refresh).toBe(
    "2026-10-13T00:00:00Z",
  );
});

test("Claude OAuth uses the native credential layout", () => {
  expect(
    JSON.parse(buildClaudeCredentialsJson({ access: "access", refresh: "refresh", expires: 123 })),
  ).toEqual({
    claudeAiOauth: {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 123,
      scopes: ["user:inference", "user:profile"],
    },
  });
});

test("legacy incomplete ChatGPT credentials fail with a reconnect instruction, not broken auth.json", () => {
  expect(() =>
    buildCodexAuthJson({ type: "oauth", refresh: "refresh", access: "access" }, "now"),
  ).toThrow("Reconnect the saved ChatGPT account");
});
