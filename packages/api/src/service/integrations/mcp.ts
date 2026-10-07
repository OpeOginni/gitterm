import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, db, eq, sql } from "@gitterm/db";
import { mcpConnection } from "@gitterm/db/schema/mcp";
import { mcpAuthentication, mcpConnectionInput, type McpAuthentication } from "@gitterm/schema/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { getEncryptionService } from "../encryption";
import { integrationPolicy } from "./catalog";
import type { Connection, CreateConnectionResult } from "./connections";
import type { McpWorkspaceConnection } from "./mcp-config";
import { McpNetworkError, mcpFetchWithin, resolveMcpEndpoint } from "./mcp-network";
import { coordinate } from "../coordination";

type McpRow = typeof mcpConnection.$inferSelect;
export const mcpAuthContext = (id: string) => `gitterm:mcp:${id}:auth`;

/** Bearer tokens are stored as an Authorization header; label them so the edit form can tell. */
function mcpAuthType(auth: McpAuthentication): McpRow["authType"] {
  if (auth.type === "none") return "none";
  const names = Object.keys(auth.headers);
  return names.length === 1 && /^Bearer \S/.test(auth.headers.Authorization ?? "")
    ? "bearer"
    : "headers";
}

export function mcpPublicConnection(row: McpRow): Connection {
  return {
    id: row.id,
    integration: row.integration,
    kind: "personal",
    name: row.name,
    status: row.status,
    connectedAt: row.connectedAt,
    details: {
      integration: row.integration,
      revision: row.revision,
      url: row.url,
      authType: row.authType,
      codemode: row.codemode,
      toolCount: row.toolCount,
      serverInfo: row.serverInfo,
      lastCheckedAt: row.lastCheckedAt,
    },
  };
}

export async function requireMcpRow(userId: string, id: string): Promise<McpRow> {
  const [row] = await db
    .select()
    .from(mcpConnection)
    .where(and(eq(mcpConnection.id, id), eq(mcpConnection.userId, userId)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "MCP connection not found" });
  const policy = await integrationPolicy(row.integration);
  if (!policy.enabled || !policy.allowPersonal)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This MCP integration is disabled by your admin",
    });
  return row;
}

export async function listMcpConnections(userId: string): Promise<Connection[]> {
  const [rows, mcp, executor] = await Promise.all([
    db.select().from(mcpConnection).where(eq(mcpConnection.userId, userId)),
    integrationPolicy("mcp"),
    integrationPolicy("executor"),
  ]);
  return rows
    .filter((row) => {
      const policy = row.integration === "executor" ? executor : mcp;
      return policy.enabled && policy.allowPersonal;
    })
    .map(mcpPublicConnection);
}

export function readMcpAuth(row: McpRow): McpAuthentication {
  return mcpAuthentication.parse(
    JSON.parse(getEncryptionService().decrypt(row.encryptedAuth, mcpAuthContext(row.id))),
  );
}

/** Only provisioning can read credentials. Read/list APIs never return them. */
export async function resolveMcpWorkspaceConnection(
  userId: string,
  id: string,
): Promise<McpWorkspaceConnection> {
  const row = await requireMcpRow(userId, id);
  if (row.status !== "connected")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `MCP connection ${row.name} needs a successful connection test before attaching`,
    });
  const auth = readMcpAuth(row);
  return {
    connectionId: row.id,
    name: row.name,
    url: row.url,
    codemode: row.codemode,
    headers: auth.type === "headers" ? auth.headers : {},
  };
}

/** Checks metadata only; never calls a tool or starts an OAuth flow. Runtime traffic
 * goes directly from OpenCode to the server, not through the GitTerm API.
 */
export async function testMcpConnection(userId: string, id: string) {
  const row = await requireMcpRow(userId, id);
  const allowed = await coordinate((repository) => repository.allowMcpTest(userId, id));
  if (!allowed)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many connection tests. Try again in a minute.",
    });
  const client = new Client({ name: "gitterm-connection-test", version: "1.0.0" });
  let transport: StreamableHTTPClientTransport | undefined;
  let status: "connected" | "needs_auth" | "error" = "connected";
  let message =
    "Metadata test succeeded from the GitTerm API host. This does not verify workspace connectivity, tool authorization, or elicitation.";
  let toolCount: number | null = null;
  let serverInfo: McpRow["serverInfo"] = null;
  try {
    const auth = readMcpAuth(row);
    transport = new StreamableHTTPClientTransport(new URL(row.url), {
      fetch: mcpFetchWithin(AbortSignal.timeout(60_000)),
      requestInit: { headers: auth.type === "headers" ? auth.headers : {} },
      reconnectionOptions: {
        maxRetries: 0,
        maxReconnectionDelay: 1000,
        initialReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
    });
    await client.connect(transport, { timeout: 30_000 });
    const info = client.getServerVersion();
    serverInfo = info
      ? { name: info.name.slice(0, 200), version: info.version.slice(0, 100) }
      : null;
    toolCount = 0;
    if (client.getServerCapabilities()?.tools) {
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const tools = await client.listTools(cursor ? { cursor } : {}, { timeout: 30_000 });
        toolCount += tools.tools.length;
        cursor = tools.nextCursor;
        if (!cursor) break;
        if (page === 19) throw new Error("Too many catalog pages");
      }
    }
  } catch (error) {
    console.warn(`[mcp] connection test failed for ${row.id}:`, error);
    status =
      error instanceof StreamableHTTPError && [401, 403].includes(error.code ?? 0)
        ? "needs_auth"
        : "error";
    message =
      error instanceof McpNetworkError
        ? error.message
        : status === "needs_auth"
          ? "Authentication was rejected. Update the token or headers. GitTerm-managed OAuth is not supported."
          : "Could not initialize this MCP server. Check its endpoint and classic Streamable HTTP support.";
  } finally {
    await transport?.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
  const [updated] = await db
    .update(mcpConnection)
    .set({
      status,
      toolCount: status === "connected" ? toolCount : null,
      serverInfo: status === "connected" ? serverInfo : null,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mcpConnection.id, id),
        eq(mcpConnection.userId, userId),
        eq(mcpConnection.revision, row.revision),
      ),
    )
    .returning();
  if (!updated)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Connection changed during the test. Test its latest settings again.",
    });
  return { status, message, connection: mcpPublicConnection(updated) };
}

export async function createMcpConnection(
  userId: string,
  input: z.infer<typeof mcpConnectionInput>,
): Promise<CreateConnectionResult> {
  await resolveMcpEndpoint(input.url).catch((error) => {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof McpNetworkError ? error.message : "Invalid MCP endpoint",
    });
  });
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`gitterm:mcp:${userId}`}, 0))`,
    );
    const existing = await tx
      .select({ id: mcpConnection.id })
      .from(mcpConnection)
      .where(eq(mcpConnection.userId, userId))
      .limit(50);
    if (existing.length >= 50)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You can save at most 50 MCP connections. Remove an unused connection first.",
      });
    await tx.insert(mcpConnection).values({
      id,
      userId,
      integration: input.integration,
      name: input.name,
      url: input.url,
      authType: mcpAuthType(input.authentication),
      codemode: input.codemode,
      encryptedAuth: getEncryptionService().encrypt(
        JSON.stringify(input.authentication),
        mcpAuthContext(id),
      ),
    });
  });
  // The connection is saved either way; a refused or failed test leaves it to test later.
  const result = await testMcpConnection(userId, id).catch(async (error: unknown) => ({
    status: "saved" as const,
    connection: mcpPublicConnection(await requireMcpRow(userId, id)),
    message: `Saved. ${error instanceof Error ? error.message : "Test it again later."}`,
  }));
  return {
    status: result.status === "connected" ? "connected" : "saved",
    connection: result.connection,
    nextSteps: [],
    message: result.message,
  };
}

export const updateMcpConnectionInput = mcpConnectionInput
  .omit({ integration: true })
  .extend({ id: z.uuid(), authentication: mcpConnectionInput.shape.authentication.optional() });
export async function updateMcpConnection(
  userId: string,
  input: z.infer<typeof updateMcpConnectionInput>,
) {
  await requireMcpRow(userId, input.id);
  await resolveMcpEndpoint(input.url).catch(() => {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Use a public HTTPS MCP endpoint" });
  });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(mcpConnection)
      .where(and(eq(mcpConnection.id, input.id), eq(mcpConnection.userId, userId)))
      .for("update");
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "MCP connection not found" });
    const changed = row.url !== input.url || input.authentication !== undefined;
    if (row.url !== input.url && !input.authentication)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Select authentication again when changing the MCP endpoint",
      });
    const [updated] = await tx
      .update(mcpConnection)
      .set({
        name: input.name,
        url: input.url,
        codemode: input.codemode,
        revision: row.revision + 1,
        updatedAt: new Date(),
        ...(input.authentication
          ? {
              authType: mcpAuthType(input.authentication),
              encryptedAuth: getEncryptionService().encrypt(
                JSON.stringify(input.authentication),
                mcpAuthContext(row.id),
              ),
            }
          : {}),
        ...(changed
          ? { status: "untested" as const, toolCount: null, serverInfo: null, lastCheckedAt: null }
          : {}),
      })
      .where(eq(mcpConnection.id, row.id))
      .returning();
    return mcpPublicConnection(updated!);
  });
}
