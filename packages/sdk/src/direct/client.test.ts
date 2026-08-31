import { describe, expect, test } from "bun:test";
import { createDirectGittermClient } from "./client";
import type { DirectProviderAdapter, DirectRun } from "./types";

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

  test("keeps a run running until an assistant message exists", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path === "/session/status") return Response.json({});
      if (path === "/session/session-1/message") return Response.json([]);
      throw new Error(`Unexpected request: ${request.method} ${path}`);
    }) as typeof fetch;

    try {
      const { provider } = fakeProvider();
      const client = createDirectGittermClient({ provider });
      const workspace = await client.workspaces.create();
      const run: DirectRun = {
        id: "run-1",
        workspaceId: workspace.id,
        sessionId: "session-1",
        messageId: "message-1",
        title: "Run",
        status: "running",
        error: null,
        finalText: null,
        submittedAt: new Date(Date.now() - 30_000).toISOString(),
      };

      expect(await client.runs.get(run, workspace)).toMatchObject({
        status: "running",
        error: null,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps a completed run terminal when the session is busy with a later prompt", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path === "/session/status") {
        return Response.json({ "session-1": { type: "busy" } });
      }
      if (path === "/session/session-1/message") {
        return Response.json([
          {
            info: {
              id: "assistant-1",
              role: "assistant",
              parentID: "message-1",
              time: { completed: Date.now() },
            },
            parts: [{ type: "text", text: "done", ignored: false }],
          },
        ]);
      }
      throw new Error(`Unexpected request: ${request.method} ${path}`);
    }) as typeof fetch;

    try {
      const { provider } = fakeProvider();
      const client = createDirectGittermClient({ provider });
      const workspace = await client.workspaces.create();
      const run: DirectRun = {
        id: "run-1",
        workspaceId: workspace.id,
        sessionId: "session-1",
        messageId: "message-1",
        title: "Run",
        status: "running",
        error: null,
        finalText: null,
        submittedAt: new Date().toISOString(),
      };

      expect(await client.runs.get(run, workspace)).toMatchObject({
        status: "completed",
        finalText: "done",
      });
      expect(await client.runs.cancel(run, workspace)).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("runs a headless OAuth flow through the workspace runtime", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ method: string; path: string; authorization: string | null }> = [];
    let statusRequests = 0;
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      requests.push({
        method: request.method,
        path: url.pathname,
        authorization: request.headers.get("authorization"),
      });
      const location = {
        directory: "/workspace",
        project: { id: "project", directory: "/workspace" },
      };

      if (request.method === "PUT" && url.pathname === "/auth/openai") {
        expect(await request.json()).toEqual({
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: 123_000,
          accountId: "account-1",
        });
        return Response.json(true);
      }

      if (request.method === "GET" && url.pathname === "/api/integration/openai") {
        return Response.json({
          location,
          data: {
            id: "openai",
            name: "OpenAI",
            methods: [{ type: "oauth", id: "chatgpt-headless", label: "ChatGPT" }],
            connections: [],
          },
        });
      }
      if (request.method === "POST" && url.pathname === "/api/integration/openai/connect/oauth") {
        expect(await request.json()).toEqual({
          methodID: "chatgpt-headless",
          inputs: {},
          label: "Slack bot",
        });
        return Response.json({
          location,
          data: {
            attemptID: "attempt-1",
            url: "https://auth.example/device",
            instructions: "Enter ABCD",
            mode: "auto",
            time: { created: 1_000, expires: Date.now() + 60_000 },
          },
        });
      }
      if (request.method === "GET" && url.pathname === "/api/integration/attempt/attempt-1") {
        statusRequests += 1;
        return Response.json({
          location,
          data: {
            status: statusRequests === 1 ? "pending" : "complete",
            time: { created: 1_000, expires: Date.now() + 60_000 },
          },
        });
      }
      throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
    }) as typeof fetch;

    try {
      const { provider } = fakeProvider();
      const client = createDirectGittermClient({ provider });
      const workspace = await client.workspaces.create({ lifecycle: "persistent" });
      workspace.runtime.password = "secret";

      await client.auth.setCredential(workspace, {
        type: "oauth",
        providerName: "openai",
        refreshToken: "refresh-token",
        accessToken: "access-token",
        expiresAt: 123_000,
        accountId: "account-1",
      });

      const integration = await client.auth.get(workspace, "openai");
      expect(integration.methods[0]).toMatchObject({ id: "chatgpt-headless", type: "oauth" });

      const attempt = await client.auth.connectOAuth({
        workspace,
        integrationId: "openai",
        methodId: "chatgpt-headless",
        label: "Slack bot",
      });
      expect(attempt).toMatchObject({
        id: "attempt-1",
        workspaceId: workspace.id,
        mode: "auto",
      });
      expect(await client.auth.wait(attempt, workspace, { pollIntervalMs: 0 })).toMatchObject({
        status: "complete",
      });
      expect(
        requests.every((request) => request.authorization === "Basic b3BlbmNvZGU6c2VjcmV0"),
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
