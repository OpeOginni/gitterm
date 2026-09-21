import { expect, test } from "bun:test";
import {
  OPENCODE_CREDENTIALS_PATH,
  OPENCODE_CREDENTIALS_PLUGIN_PATH,
} from "@gitterm/agent-runtime/opencode-credentials";
import { buildOpencodeAuthJson, opencodeProvisioner } from "./opencode";
import type { AgentProvisionerContext, UserProviderCredential } from "./types";

const credentials: UserProviderCredential[] = [
  {
    credentialId: "credential",
    providerName: "openai-oauth",
    logicalProviderKey: "openai",
    credential: { type: "oauth", refresh: "refresh-token" },
  },
  {
    credentialId: "api-key",
    providerName: "anthropic",
    logicalProviderKey: "anthropic",
    credential: { type: "api_key", apiKey: "api-key-value" },
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

test("maps dashboard credentials onto OpenCode provider IDs", () => {
  expect(JSON.parse(buildOpencodeAuthJson(credentials))).toEqual({
    openai: { type: "oauth", refresh: "refresh-token" },
    anthropic: { type: "api", key: "api-key-value" },
  });
});

test("workspaces receive the credentials file and importer plugin", () => {
  const files = opencodeProvisioner.provision(context).files;
  const paths = files.map((file) => file.path);
  expect(paths).not.toContain("~/.local/share/opencode/auth.json");
  expect(paths).toContain(OPENCODE_CREDENTIALS_PLUGIN_PATH);
  const credentialFile = files.find((file) => file.path === OPENCODE_CREDENTIALS_PATH)!;
  expect(credentialFile.mode).toBe(0o600);
  expect(JSON.parse(Buffer.from(credentialFile.contentBase64, "base64").toString())).toEqual({
    openai: { type: "oauth", refresh: "refresh-token" },
    anthropic: { type: "api", key: "api-key-value" },
  });
});
