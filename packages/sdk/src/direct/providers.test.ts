import { describe, expect, test } from "bun:test";
import { SANDBOX_PROVIDER_PROFILES } from "@gitterm/agent-runtime/sandbox/types";
import { createDirectGittermClient } from "./client";
import { createTransportDirectProvider } from "./transport";
import type { DirectProviderConfig } from "./types";

const configs: DirectProviderConfig[] = [
  { type: "e2b", apiKey: "key" },
  { type: "daytona", apiKey: "key", target: "us" },
  { type: "vercel", apiToken: "key", teamId: "team", projectId: "project" },
  { type: "boat", apiKey: "key" },
  { type: "exedev", apiToken: "key" },
  {
    type: "railway",
    apiToken: "key",
    projectId: "project",
    environmentId: "environment",
  },
];

describe("built-in direct providers", () => {
  test("all provider configs resolve through the standard client", () => {
    expect(
      configs.map((config) => createDirectGittermClient({ provider: config }).provider.name),
    ).toEqual(["e2b", "daytona", "vercel", "boat", "exedev", "railway"]);
  });

  test("all providers declare coherent lifecycle capabilities", () => {
    for (const config of configs) {
      const capabilities = createDirectGittermClient({ provider: config }).provider.capabilities;
      expect(capabilities.ephemeralPause === "unsupported").toBe(!capabilities.supportsPause);
    }
  });

  test("a workspace on an existing sandbox is set up there, and terminating it keeps the sandbox", async () => {
    const calls: string[] = [];
    const transport = {
      provider: "exedev" as const,
      home: "/home/exedev",
      capabilities: SANDBOX_PROVIDER_PROFILES.exedev.capabilities,
      async create() {
        calls.push("create");
        throw new Error("must not create");
      },
      async info(id: string) {
        return { id, state: "running" as const, labels: {}, startedAt: null, expiresAt: null };
      },
      async list() {
        return [];
      },
      async destroy(id: string) {
        calls.push(`destroy ${id}`);
      },
      async pause() {},
      async resume() {},
      async run(id: string, command: string) {
        calls.push(`run ${id}: ${command.split("\n")[0]!.slice(0, 40)}`);
        return {
          exitCode: 0,
          stdout: command.includes('"$HOME"') ? "/home/exedev" : "",
          stderr: "",
        };
      },
      async writeFile() {},
      async readFile() {
        return new Uint8Array();
      },
      async preview() {
        return { url: "https://existing-vm.example/", headers: {} };
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("ok")) as unknown as typeof fetch;
    try {
      const client = createDirectGittermClient({
        provider: createTransportDirectProvider({
          name: "exedev",
          capabilities: {
            persistence: "supported",
            recommendedLifecycle: "ephemeral",
            supportsPause: true,
            ephemeralPause: "stateful",
            supportsKeepAlive: false,
          },
          transport,
          timeoutMs: 60 * 60_000,
          existing: (input) => input.exedev?.existingVmName,
        }),
      });
      const workspace = await client.workspaces.create({
        id: "attached-workspace",
        exedev: { existingVmName: "existing-vm" },
      });
      expect(workspace.externalId).toBe("existing:existing-vm");
      expect(workspace.runtime.directory).toBe("/home/exedev/workspace");
      await client.workspaces.terminate(workspace);

      expect(calls).not.toContain("create");
      expect(calls.some((call) => call.startsWith("destroy"))).toBe(false);
      expect(calls.at(-1)).toContain("agent.pid");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
