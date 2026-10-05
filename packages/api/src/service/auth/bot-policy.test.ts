import { describe, expect, test } from "bun:test";
import { checkBotRequest, type BotIdentity } from "./bot-policy";

const identity = {
  id: "bot",
  repo: "https://github.com/acme/app#main",
  model: "anthropic/sonnet",
  credential: "team",
  connections: ["Linear"],
  provider: "railway",
  githubAccess: "connection",
} as BotIdentity;
const workspaceId = "12345678-1234-4234-8234-123456789012";
const input = () => ({
  repo: "https://github.com/acme/app",
  branch: "main",
  agent: "opencode",
  provider: { type: "railway" },
  connections: ["github", "Linear"],
  models: {
    default: identity.model,
    providers: { anthropic: { source: "saved", label: "team" } },
  },
});

describe("delegated bot policy", () => {
  test("only declared workspace and run operations expose a target for bot-ownership validation", () => {
    for (const route of [
      "run.create",
      "run.get",
      "run.messages",
      "run.respond",
      "run.cancel",
      "run.lifecycle",
      "workspace.getWorkspace",
      "workspace.deleteWorkspace",
      "workspace.ensureRunning",
    ]) {
      expect(checkBotRequest(identity, route, { workspaceId })).toBe(workspaceId);
    }
    expect(() =>
      checkBotRequest(identity, "workspace.getWorkspace", { workspaceId: "not-a-uuid" }),
    ).toThrow();
    expect(() => checkBotRequest(identity, "workspace.futureAccountWideOperation", {})).toThrow();
    expect(() => checkBotRequest(identity, "integrations.github.repositories", {})).toThrow();
    expect(() => checkBotRequest(identity, "modelCredentials.storeApiKey", {})).toThrow();
  });
  test("provisioning permits only the saved repository, provider and delegated credentials", () => {
    expect(checkBotRequest(identity, "workspace.createWorkspace", input())).toBeUndefined();
    for (const patch of [
      { repo: "https://github.com/acme/private" },
      { branch: "other" },
      { agentTypeId: "legacy" },
      { agent: "t3code" },
      { provider: { type: "aws" } },
      // The owner's AWS roles are never the bot's to pick.
      { provider: { type: "railway", accessProfile: "admin-role" } },
      // A saved credential is named, not left to the provider default.
      { models: { default: identity.model } },
      { connections: ["Production"] },
      { repositoryCredentials: { token: "own-token" } },
      { models: undefined },
      { models: { default: identity.model, inherit: "defaults" } },
      {
        models: {
          default: identity.model,
          providers: { anthropic: { source: "saved", label: "personal" } },
        },
      },
      { models: { default: identity.model, providers: { openai: { source: "default" } } } },
      { models: { default: identity.model, providers: { anthropic: { source: "default" } } } },
    ])
      expect(() =>
        checkBotRequest(identity, "workspace.createWorkspace", { ...input(), ...patch }),
      ).toThrow();
  });
  test("connection discovery and run models cannot exceed saved capabilities", () => {
    expect(
      checkBotRequest(identity, "integrations.connections.resolve", {
        references: ["Linear"],
        repo: input().repo,
      }),
    ).toBeUndefined();
    expect(() =>
      checkBotRequest(identity, "integrations.connections.resolve", {
        references: ["Production"],
        repo: input().repo,
      }),
    ).toThrow();
    expect(() =>
      checkBotRequest(identity, "integrations.connections.resolve", {
        references: ["github"],
        repo: "https://github.com/other/private",
      }),
    ).toThrow();
    expect(() =>
      checkBotRequest(identity, "run.create", { workspaceId, model: "openai/personal" }),
    ).toThrow();
  });
});
