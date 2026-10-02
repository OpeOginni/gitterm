export type McpWorkspaceConnection = {
  connectionId: string;
  name: string;
  url: string;
  codemode: boolean;
  headers: Record<string, string>;
};

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
    const name = `gitterm_${connection.connectionId.replace(/-/g, "_")}`;
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
      ...(Object.keys(headers).length ? { headers } : {}),
    };
  }
  return { config: { ...config, mcp: { ...mcp, servers } }, env };
}
