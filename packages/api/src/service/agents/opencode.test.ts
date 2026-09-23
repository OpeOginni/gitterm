import { expect, test } from "bun:test";
import {
  OPENCODE_CREDENTIALS_PATH,
  OPENCODE_CREDENTIALS_PLUGIN_PATH,
} from "@gitterm/agent-runtime/opencode-credentials";
import { buildOpencodeAuthJson, buildOpencodeCredentials, opencodeProvisioner } from "./opencode";
import type { AgentProvisionerContext, UserProviderCredential } from "./types";

const credentials: UserProviderCredential[] = [
  {
    credentialId: "subscription",
    providerName: "openai-oauth",
    logicalProviderKey: "openai",
    label: "subscription",
    isDefault: true,
    credential: { type: "oauth", refresh: "refresh-token" },
  },
  {
    credentialId: "openai-work",
    providerName: "openai",
    logicalProviderKey: "openai",
    label: "work",
    isDefault: false,
    credential: { type: "api_key", apiKey: "sk-openai-work" },
  },
  {
    credentialId: "anthropic-work",
    providerName: "anthropic",
    logicalProviderKey: "anthropic",
    label: "work",
    isDefault: false,
    credential: { type: "api_key", apiKey: "sk-ant-work" },
  },
  {
    credentialId: "anthropic-home",
    providerName: "anthropic",
    logicalProviderKey: "anthropic",
    label: "personal",
    isDefault: true,
    credential: { type: "api_key", apiKey: "sk-ant-home" },
  },
];

const context: AgentProvisionerContext = {
  userId: "user",
  userDisplayName: "User",
  workspaceHostname: "ws.gitterm.dev",
  agentTypeName: "OpenCode",
  serverOnly: true,
  credentials,
};

test("every dashboard account travels with its label and default flag", () => {
  expect(buildOpencodeCredentials(credentials)).toEqual([
    {
      integration: "openai",
      label: "subscription",
      active: true,
      value: { type: "oauth", refresh: "refresh-token" },
    },
    { integration: "openai", label: "work", value: { type: "api", key: "sk-openai-work" } },
    { integration: "anthropic", label: "work", value: { type: "api", key: "sk-ant-work" } },
    {
      integration: "anthropic",
      label: "personal",
      active: true,
      value: { type: "api", key: "sk-ant-home" },
    },
  ]);
});

test("equal labels that land on one OpenCode integration stay distinct", () => {
  const entries = buildOpencodeCredentials([
    { ...credentials[0]!, label: "main" },
    { ...credentials[1]!, label: "main" },
  ]);
  expect(entries.map((entry) => entry.label)).toEqual(["main", "main (openai)"]);
});

test("OpenCode 1.x auth.json keeps one account per provider, preferring the default", () => {
  expect(JSON.parse(buildOpencodeAuthJson(credentials))).toEqual({
    openai: { type: "oauth", refresh: "refresh-token" },
    anthropic: { type: "api", key: "sk-ant-home" },
  });
});

test("workspaces receive the credentials file and importer plugin", () => {
  const files = opencodeProvisioner.provision(context).files;
  const paths = files.map((file) => file.path);
  expect(paths).not.toContain("~/.local/share/opencode/auth.json");
  expect(paths).toContain(OPENCODE_CREDENTIALS_PLUGIN_PATH);
  const credentialFile = files.find((file) => file.path === OPENCODE_CREDENTIALS_PATH)!;
  expect(credentialFile.mode).toBe(0o600);
  expect(JSON.parse(Buffer.from(credentialFile.contentBase64, "base64").toString())).toEqual(
    buildOpencodeCredentials(credentials),
  );
});

const extras: UserProviderCredential[] = [
  {
    credentialId: "cloudflare",
    providerName: "cloudflare-workers-ai",
    logicalProviderKey: "cloudflare-workers-ai",
    label: "default",
    isDefault: true,
    credential: { type: "api_key", apiKey: "cf-key", metadata: { accountId: "a".repeat(32) } },
  },
  {
    credentialId: "zen",
    providerName: "opencode",
    logicalProviderKey: "opencode",
    label: "zen",
    isDefault: false,
    credential: { type: "api_key", apiKey: "zen-key" },
  },
  {
    credentialId: "console",
    providerName: "opencode-console",
    logicalProviderKey: "opencode",
    label: "Acme",
    isDefault: true,
    credential: {
      type: "oauth",
      refresh: "oc-refresh",
      access: "oc-access",
      expires: 1,
      metadata: { server: "https://opencode.ai/console", orgID: "org_1" },
    },
  },
];

test("provider settings and OAuth metadata reach the OpenCode integration", () => {
  expect(buildOpencodeCredentials(extras)).toEqual([
    {
      integration: "cloudflare-workers-ai",
      label: "default",
      active: true,
      value: { type: "api", key: "cf-key", metadata: { accountId: "a".repeat(32) } },
    },
    { integration: "opencode", label: "zen", value: { type: "api", key: "zen-key" } },
    {
      integration: "opencode",
      label: "Acme",
      active: true,
      value: {
        type: "oauth",
        refresh: "oc-refresh",
        access: "oc-access",
        expires: 1,
        metadata: { server: "https://opencode.ai/console", orgID: "org_1" },
      },
    },
  ]);
});

test("OpenCode 1.x auth.json skips the console account it cannot use", () => {
  expect(JSON.parse(buildOpencodeAuthJson(extras))).toEqual({
    "cloudflare-workers-ai": {
      type: "api",
      key: "cf-key",
      metadata: { accountId: "a".repeat(32) },
    },
    opencode: { type: "api", key: "zen-key" },
  });
});
