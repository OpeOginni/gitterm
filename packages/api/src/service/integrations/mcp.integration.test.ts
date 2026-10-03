import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, db, eq } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import { agentType, cloudProvider, image } from "@gitterm/db/schema/cloud";
import { integrationSettings } from "@gitterm/db/schema/integrations";
import { mcpConnection, workspaceMcpConnection } from "@gitterm/db/schema/mcp";
import { workspace } from "@gitterm/db/schema/workspace";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import {
  createConnection,
  getConnection,
  listConnections,
  removeConnection,
  resolveWorkspaceConnections,
} from "./connections";
import { readMcpAuth, testMcpConnection, updateMcpConnection } from "./mcp";
import { withMcpConnections } from "./mcp-config";
import * as network from "./mcp-network";

// Opt-in only: never mutate the developer's normal database. Apply migrations first.
const testDatabase = process.env.MCP_TEST_DATABASE_URL;
describe.skipIf(!testDatabase)("direct MCP integration (isolated PostgreSQL)", () => {
  const owner = `mcp-test-${randomUUID()}`;
  const other = `mcp-test-${randomUUID()}`;
  const providerId = randomUUID();
  const agentId = randomUUID();
  const imageId = randomUUID();
  const servers: McpServer[] = [];
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
  let calls = 0;
  let rejectAuthentication = false;
  const upstreamUrl = "https://upstream.mcp-test.example/mcp";

  const upstream: FetchLike = async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (rejectAuthentication)
      return new Response("upstream token details must not escape", { status: 401 });
    if (request.headers.get("authorization") !== "Bearer upstream-secret")
      return new Response("wrong auth", { status: 403 });
    let transport = sessions.get(request.headers.get("mcp-session-id") ?? "");
    if (!transport) {
      if (request.headers.has("mcp-session-id"))
        return new Response("invalid session", { status: 404 });
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const server = new McpServer({ name: "fixture", version: "1.0.0" });
      server.registerTool("echo", { inputSchema: { text: z.string() } }, ({ text }) => {
        calls++;
        return { content: [{ type: "text", text }] };
      });
      transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => {
          sessions.set(id, transport!);
        },
        keepAliveMs: 0,
      });
      await server.connect(transport);
      servers.push(server);
    }
    return transport.handleRequest(request);
  };

  function mockNetwork() {
    spyOn(network, "resolveMcpEndpoint").mockImplementation(async (value) => ({
      url: new URL(value),
      address: { address: "1.1.1.1", family: 4 },
    }));
    spyOn(network, "mcpFetch").mockImplementation(upstream);
  }

  beforeAll(async () => {
    if (
      process.env.DATABASE_URL !== testDatabase ||
      !new URL(testDatabase!).pathname.endsWith("_mcp_test")
    )
      throw new Error(
        "Use an isolated *_mcp_test database with DATABASE_URL=MCP_TEST_DATABASE_URL",
      );
    const now = new Date();
    await db.insert(user).values(
      [owner, other].map((id) => ({
        id,
        name: id,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(cloudProvider).values({ id: providerId, name: `mcp-test-${providerId}` });
    await db
      .insert(agentType)
      .values({ id: agentId, key: `mcp-test-${agentId}`, name: `mcp-test-${agentId}` });
    await db.insert(image).values({
      id: imageId,
      name: `mcp-test-${imageId}`,
      imageId: "fixture",
      agentTypeId: agentId,
    });
    for (const key of ["mcp", "executor"])
      await db
        .insert(integrationSettings)
        .values({ key, enabled: true, allowPersonal: true, allowShared: false })
        .onConflictDoUpdate({
          target: integrationSettings.key,
          set: { enabled: true, allowPersonal: true, allowShared: false },
        });
  });
  afterEach(async () => {
    mock.restore();
    rejectAuthentication = false;
    for (const server of servers.splice(0)) await server.close();
    sessions.clear();
    await db
      .update(integrationSettings)
      .set({ enabled: true })
      .where(eq(integrationSettings.key, "mcp"));
  });
  afterAll(async () => {
    await db.delete(user).where(eq(user.id, owner));
    await db.delete(user).where(eq(user.id, other));
    await db.delete(cloudProvider).where(eq(cloudProvider.id, providerId));
    await db.delete(agentType).where(eq(agentType.id, agentId));
  });

  async function connection(integration: "mcp" | "executor" = "mcp") {
    mockNetwork();
    const result = await createConnection(owner, {
      integration,
      name: "Tools",
      url: upstreamUrl,
      authentication: { type: "headers", headers: { Authorization: "Bearer upstream-secret" } },
      codemode: true,
    });
    expect(result.status).toBe("connected");
    if (result.status === "pending") throw new Error("Unexpected browser flow");
    return result.connection;
  }

  test("custom MCP and Executor share creation, encrypted storage, testing and multiple attachments", async () => {
    const a = await connection();
    const b = await connection();
    const c = await connection("executor");
    const resolved = await resolveWorkspaceConnections(owner, [a.id, b.id, c.id, a.id]);
    expect(resolved.mcp).toHaveLength(3);
    expect(resolved.mcp[0]!.headers).toEqual({ Authorization: "Bearer upstream-secret" });
    const [row] = await db.select().from(mcpConnection).where(eq(mcpConnection.id, a.id));
    expect(row!.encryptedAuth).not.toContain("upstream-secret");
    expect(() => readMcpAuth({ ...row!, id: randomUUID() })).toThrow();
    expect(JSON.stringify(await listConnections(owner))).not.toContain("upstream-secret");
    expect(await listConnections(other)).toEqual([]);
    expect(await getConnection(other, a.id)).toBeNull();
    await expect(resolveWorkspaceConnections(other, [a.id])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(calls).toBe(0); // Testing/discovery never executes a tool.
  });

  test("OpenCode-shaped configuration connects directly without GitTerm traffic", async () => {
    const saved = await connection("executor");
    const resolved = await resolveWorkspaceConnections(owner, [saved.id]);
    const { config, env } = withMcpConnections(undefined, resolved.mcp);
    const definition = Object.values((config!.mcp as any).servers)[0] as {
      url: string;
      headers: Record<string, string>;
    };
    expect(definition.url).toBe(upstreamUrl);
    const headers = Object.fromEntries(
      Object.entries(definition.headers).map(([key, value]) => [
        key,
        value.startsWith("{env:") ? env[value.slice(5, -1)]! : value,
      ]),
    );
    const client = new Client({ name: "workspace", version: "1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(definition.url), {
      fetch: upstream,
      requestInit: { headers },
    });
    try {
      await client.connect(transport);
      expect(
        (await client.callTool({ name: "echo", arguments: { text: "direct" } })).content,
      ).toEqual([{ type: "text", text: "direct" }]);
    } finally {
      await transport.terminateSession().catch(() => undefined);
      await client.close();
    }
  });

  test("failed authentication is saved safely, cannot attach, and is repaired through the same API", async () => {
    mockNetwork();
    rejectAuthentication = true;
    const result = await createConnection(owner, {
      integration: "mcp",
      name: "Broken",
      url: upstreamUrl,
      authentication: { type: "none" },
      codemode: true,
    });
    expect(result.status).toBe("saved");
    if (result.status === "pending") throw new Error("Unexpected pending");
    expect(result.connection.status).toBe("needs_auth");
    expect(result.message).not.toContain("upstream token details");
    await expect(resolveWorkspaceConnections(owner, [result.connection.id])).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    rejectAuthentication = false;
    await updateMcpConnection(owner, {
      id: result.connection.id,
      name: "Fixed",
      url: upstreamUrl,
      codemode: false,
      authentication: { type: "headers", headers: { Authorization: "Bearer upstream-secret" } },
    });
    expect((await testMcpConnection(owner, result.connection.id)).status).toBe("connected");
    expect(
      (await resolveWorkspaceConnections(owner, [result.connection.id])).mcp[0]!.codemode,
    ).toBe(false);
  });

  test("edits preserve encrypted credentials, require authentication for URL changes, and enforce ownership/policy", async () => {
    const saved = await connection();
    await updateMcpConnection(owner, {
      id: saved.id,
      name: "Renamed",
      url: upstreamUrl,
      codemode: true,
    });
    const [row] = await db.select().from(mcpConnection).where(eq(mcpConnection.id, saved.id));
    expect(readMcpAuth(row!)).toEqual({
      type: "headers",
      headers: { Authorization: "Bearer upstream-secret" },
    });
    await expect(
      updateMcpConnection(owner, {
        id: saved.id,
        name: "Moved",
        url: "https://new.example/mcp",
        codemode: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(testMcpConnection(other, saved.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(removeConnection(other, saved.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db
      .update(integrationSettings)
      .set({ enabled: false })
      .where(eq(integrationSettings.key, "mcp"));
    expect(await listConnections(owner, { integration: "mcp" })).toEqual([]);
    await expect(resolveWorkspaceConnections(owner, [saved.id])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(testMcpConnection(owner, saved.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("saved binding removal does not falsely revoke credentials already delivered to a workspace", async () => {
    const saved = await connection();
    const resolved = await resolveWorkspaceConnections(owner, [saved.id]);
    const injected = withMcpConnections(undefined, resolved.mcp);
    const workspaceId = randomUUID();
    await db.insert(workspace).values({
      id: workspaceId,
      userId: owner,
      externalInstanceId: "test",
      imageId,
      cloudProviderId: providerId,
      domain: `${workspaceId}.example.com`,
      status: "running",
      startedAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(workspaceMcpConnection).values({ workspaceId, connectionId: saved.id });
    await removeConnection(owner, saved.id);
    expect(
      await db
        .select()
        .from(workspaceMcpConnection)
        .where(eq(workspaceMcpConnection.workspaceId, workspaceId)),
    ).toHaveLength(0);
    expect(Object.values(injected.env)).toEqual(["Bearer upstream-secret"]);
    expect(await getConnection(owner, saved.id)).toBeNull();
  });

  test("connection quota is enforced without creating another row", async () => {
    mockNetwork();
    const existing = await db.select().from(mcpConnection).where(eq(mcpConnection.userId, owner));
    const missing = 50 - existing.length;
    await db.insert(mcpConnection).values(
      Array.from({ length: missing }, () => ({
        userId: owner,
        integration: "mcp" as const,
        name: "quotaFixture",
        url: upstreamUrl,
        authType: "none" as const,
        encryptedAuth: "unused-test-fixture",
      })),
    );
    await expect(
      createConnection(owner, {
        integration: "mcp",
        name: "Over quota",
        url: upstreamUrl,
        authentication: { type: "none" },
        codemode: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await db.select().from(mcpConnection).where(eq(mcpConnection.userId, owner)),
    ).toHaveLength(50);
    await db
      .delete(mcpConnection)
      .where(and(eq(mcpConnection.userId, owner), eq(mcpConnection.name, "quotaFixture")));
  });
});
