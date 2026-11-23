import { describe, expect, test } from "bun:test";
import { PI_EXTENSION } from "@gitterm/schema/pi";
import { buildPiAuth, piProvisioner } from "./pi";
import type { AgentProvisionerContext, UserProviderCredential } from "./types";

const credential = (
  providerName: string,
  value: UserProviderCredential["credential"],
  isDefault = true,
): UserProviderCredential => ({
  credentialId: providerName,
  providerName,
  logicalProviderKey: providerName,
  label: providerName,
  isDefault,
  credential: value,
});

const context = (credentials: UserProviderCredential[] = []): AgentProvisionerContext => ({
  userId: "u1",
  userDisplayName: "Test",
  workspaceHostname: "ws1.example",
  agentTypeName: "Pi",
  serverOnly: false,
  serverPassword: "secret",
  credentials,
  opencode: { skills: [{ name: "review", content: "# Review" }] },
});

const decoded = (files: { path: string; contentBase64: string }[], path: string) =>
  Buffer.from(files.find((file) => file.path === path)!.contentBase64, "base64").toString();

describe("Pi provisioner", () => {
  test("model credentials become Pi's auth.json, by Pi's provider ids", () => {
    const auth = buildPiAuth([
      credential("anthropic", { type: "api_key", apiKey: "sk-ant" }),
      credential("openai-oauth", {
        type: "oauth",
        refresh: "r",
        access: "a",
        expires: 5,
        accountId: "acct",
      }),
      credential("openrouter", { type: "api_key", apiKey: "old" }, false),
      credential("openrouter", { type: "api_key", apiKey: "default" }),
    ]);
    expect(auth).toEqual({
      anthropic: { type: "api_key", key: "sk-ant" },
      "openai-codex": { type: "oauth", refresh: "r", access: "a", expires: 5, accountId: "acct" },
      // The default account wins where there are several.
      openrouter: { type: "api_key", key: "default" },
    });
  });

  test("Pi runs in a password-protected browser terminal with GitTerm's files", () => {
    const provisioned = piProvisioner.provision(
      context([credential("anthropic", { type: "api_key", apiKey: "sk-ant" })]),
    );
    expect(provisioned.usesServerPassword).toBe(true);
    expect(provisioned.env.PI_WEB_PASSWORD).toBe("secret");
    expect(provisioned.serve?.port).toBe(4096);
    expect(provisioned.serve?.command).toContain('--credential "opencode:$PI_WEB_PASSWORD"');
    expect(provisioned.serve?.command).toContain("tmux new-session -A -s pi pi --continue");
    const auth = provisioned.files.find((file) => file.path === "~/.pi/agent/auth.json");
    expect(auth?.mode).toBe(0o600);
    expect(JSON.parse(decoded(provisioned.files, "~/.pi/agent/auth.json"))).toEqual({
      anthropic: { type: "api_key", key: "sk-ant" },
    });
    expect(decoded(provisioned.files, "~/.pi/agent/extensions/gitterm.ts")).toBe(PI_EXTENSION);
    expect(decoded(provisioned.files, "~/.pi/agent/skills/review/SKILL.md")).toBe("# Review");
    expect(decoded(provisioned.files, "~/.pi/agent/AGENTS.md")).toContain("GitTerm workspace");
  });
});
