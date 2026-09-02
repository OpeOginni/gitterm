import { describe, expect, test } from "bun:test";
import { createDirectGittermClient } from "./client";
import type { DirectProviderConfig } from "./types";

const configs: DirectProviderConfig[] = [
  { type: "e2b", apiKey: "key" },
  { type: "daytona", apiKey: "key", target: "us" },
  { type: "vercel", apiToken: "key", teamId: "team", projectId: "project" },
  { type: "ascii", apiKey: "key" },
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
    ).toEqual(["e2b", "daytona", "vercel", "ascii", "exedev", "railway"]);
  });

  test("all providers declare coherent lifecycle capabilities", () => {
    for (const config of configs) {
      const capabilities = createDirectGittermClient({ provider: config }).provider.capabilities;
      expect(capabilities.ephemeralPause === "unsupported").toBe(!capabilities.supportsPause);
    }
  });

  test("attaches to an existing exe.dev VM without deleting owned compute", async () => {
    const originalFetch = globalThis.fetch;
    const commands: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      if (request.url === "https://exe.dev/exec") {
        const command = await request.text();
        commands.push(command);
        if (command.startsWith("ssh-key ")) return new Response("exe0.test-token");
        if (command === "ls existing-vm") {
          return Response.json({ status: "running" });
        }
        return Response.json({ ok: true });
      }
      if (request.url === "https://existing-vm.exe.xyz/") return new Response("ok");
      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    }) as typeof fetch;

    try {
      const client = createDirectGittermClient({
        provider: { type: "exedev", apiToken: "key" },
      });
      const workspace = await client.workspaces.create({
        id: "attached-workspace",
        exedev: { existingVmName: "existing-vm" },
      });
      await client.workspaces.terminate(workspace);

      expect(commands.some((command) => command.startsWith("new "))).toBe(false);
      expect(commands).not.toContain("rm existing-vm");
      expect(commands.at(-1)).toContain("gitterm-attachedworkspace.pid");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
