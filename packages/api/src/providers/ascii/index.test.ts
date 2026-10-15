import { expect, test } from "bun:test";
import { AsciiProvider } from ".";
import type { WorkspaceConfig } from "../compute";

test("boat captures the agent-issued credential before launch and returns it to GitTerm", async () => {
  const provider = new AsciiProvider();
  const commands: string[] = [];
  const client = {
    create: async () => ({ box: { id: "box" } }),
    get: async () => ({ box: { state: "ready" } }),
    update: async () => ({}),
    stop: async () => ({}),
  };
  const internals = provider as unknown as {
    getClient: () => Promise<unknown>;
    runCommand: (client: unknown, boxId: string, command: string) => Promise<string>;
    getPrivateUrl: () => Promise<{ url: string; token: string }>;
  };
  internals.getClient = async () => client;
  internals.runCommand = async (_client, _id, command) => {
    commands.push(command);
    return command === "mint-token" ? "pairing-token\n" : "";
  };
  internals.getPrivateUrl = async () => ({ url: "https://box.example", token: "route-token" });
  const config: WorkspaceConfig = {
    workspaceId: "workspace",
    userId: "user",
    imageId: "image",
    subdomain: "ws",
    provisioningSpec: {
      agent: {
        files: [],
        env: {},
        usesServerPassword: false,
        serve: { command: "t3 start", port: 4096, accessCredentialCommand: "mint-token" },
      },
      workspaceProfile: "standard",
      editorAccessEnabled: false,
    },
  };
  const result = await provider.createWorkspace(config);
  expect(result.accessCredential).toBe("pairing-token");
  expect(result.upstreamAccess?.headers["X-GitTerm-Ascii-Token"]).toBe("route-token");
  expect(commands.indexOf("mint-token")).toBeLessThan(
    commands.findIndex((command) => command.includes("nohup setsid")),
  );
});
