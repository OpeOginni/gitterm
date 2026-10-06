export type McpWorkspaceConnection = {
  connectionId: string;
  name: string;
  url: string;
  codemode: boolean;
  headers: Record<string, string>;
};

export function workspaceMcpServerName(connectionId: string): string {
  return `gitterm_${connectionId.replace(/-/g, "_")}`;
}

/** Connection IDs, rather than display names, prevent normalization collisions. */
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
  for (const connection of connections) {
    const name = workspaceMcpServerName(connection.connectionId);
    if (name in servers || name in mcp)
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
