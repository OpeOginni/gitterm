import { describe, expect, test } from "bun:test";
import { createDirectGittermClient } from "./client";
import type { DirectProviderAdapter } from "./types";

function fakeProvider() {
  const calls: string[] = [];
  const provider: DirectProviderAdapter = {
    name: "fake",
    capabilities: {
      persistence: "supported",
      recommendedLifecycle: "ephemeral",
      supportsPause: true,
      ephemeralPause: "stateful",
      supportsKeepAlive: true,
    },
    async create(input) {
      calls.push(`create:${input.lifecycle}`);
      return {
        externalId: "external-1",
        runtime: { url: "https://runtime.example", directory: "/workspace" },
      };
    },
    async status() {
      calls.push("status");
      return "running";
    },
    async pause() {
      calls.push("pause");
    },
    async resume() {
      calls.push("resume");
      return { url: "https://resumed.example" };
    },
    async terminate() {
      calls.push("terminate");
    },
    async keepAlive(_externalId, timeoutMs) {
      calls.push(`keepAlive:${timeoutMs}`);
    },
  };
  return { provider, calls };
}

describe("createDirectGittermClient", () => {
  test("uses provider lifecycle hints and returns serializable workspace state", async () => {
    const { provider, calls } = fakeProvider();
    const client = createDirectGittermClient({ provider });
    const workspace = await client.workspaces.create();

    expect(workspace.lifecycle).toBe("ephemeral");
    expect(workspace.externalId).toBe("external-1");
    expect(JSON.parse(JSON.stringify(workspace))).toEqual(workspace);
    expect(calls).toEqual(["create:ephemeral"]);
  });

  test("delegates pause, resume, keep-alive, and termination", async () => {
    const { provider, calls } = fakeProvider();
    const client = createDirectGittermClient({ provider });
    let workspace = await client.workspaces.create({ lifecycle: "persistent" });
    workspace = await client.workspaces.pause(workspace);
    workspace = await client.workspaces.resume(workspace);
    expect(workspace.runtime.url).toBe("https://resumed.example");
    await client.workspaces.keepAlive(workspace, 30_000);
    workspace = await client.workspaces.terminate(workspace);
    expect(workspace.status).toBe("terminated");
    expect(calls).toEqual(["create:persistent", "pause", "resume", "keepAlive:30000", "terminate"]);
  });

  test("rejects persistence when an adapter cannot preserve state", async () => {
    const { provider } = fakeProvider();
    provider.capabilities.persistence = "unsupported";
    const client = createDirectGittermClient({ provider });
    expect(client.workspaces.create({ lifecycle: "persistent" })).rejects.toThrow(
      "does not support persistent",
    );
  });

  test("rejects state-losing pause for ephemeral compute", async () => {
    const { provider } = fakeProvider();
    provider.capabilities.ephemeralPause = "state-losing";
    const client = createDirectGittermClient({ provider });
    const workspace = await client.workspaces.create({ lifecycle: "ephemeral" });
    expect(client.workspaces.pause(workspace)).rejects.toThrow("without losing state");
  });
});
