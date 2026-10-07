export type McpWorkspaceConnection = {
  connectionId: string;
  name: string;
  url: string;
  codemode: boolean;
  headers: Record<string, string>;
};

/**
 * The name the user saved, so it is recognisable in OpenCode, in the characters OpenCode allows.
 * Capped because tool names are `<server>_<tool>` and providers limit those to 64 characters.
 * A name that is empty or already taken gets the start of the connection id appended.
 */
function serverName(connection: McpWorkspaceConnection, taken: (name: string) => boolean) {
  const base = connection.name
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  if (base && !taken(base)) return base;
  return `${base || "mcp"}_${connection.connectionId.slice(0, 8)}`;
}

export function withMcpConnections(
  config: Record<string, unknown> | null | undefined,
  connections: McpWorkspaceConnection[],
): { config: Record<string, unknown> | null | undefined; env: Record<string, string> } {
  const env: Record<string, string> = {};
  if (!connections.length) return { config, env };
  const raw = config?.mcp;
  const mcp =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const native = mcp.servers && typeof mcp.servers === "object" && !Array.isArray(mcp.servers);
  const servers: Record<string, unknown> = native
    ? { ...(mcp.servers as Record<string, unknown>) }
    : {};
  // V2 explicitly supports mixed members inside mcp. Leave legacy entries intact so
  // OpenCode can normalize all their OAuth/timeout fields without a partial migration.
  const taken = (candidate: string) => candidate in servers || candidate in mcp;
  for (const connection of connections) {
    const name = serverName(connection, taken);
    if (taken(name))
      throw new Error(`GitTerm MCP server name conflicts with user configuration: ${name}`);
    const headers: Record<string, string> = {};
    Object.entries(connection.headers).forEach(([header, value], index) => {
      const key = `GITTERM_MCP_${connection.connectionId.replace(/-/g, "_")}_H${index}`;
      env[key] = value;
      headers[header] = `{env:${key}}`;
    });
    servers[name] = {
      type: "remote",
      url: connection.url,
      oauth: false,
      codemode: connection.codemode,
      protocol: "legacy",
      // A resumed VM retains Bun's HTTP pool, but its old TCP connections are
      // gone. Close each HTTP connection instead of reusing a frozen socket.
      headers: { ...headers, Connection: "close" },
    };
  }
  return { config: { ...config, mcp: { ...mcp, servers } }, env };
}
