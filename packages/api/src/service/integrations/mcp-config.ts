import { createHash } from "node:crypto";
import {
  OPENCODE_CREDENTIAL_LABEL,
  type OpencodeCredentialEntry,
} from "@gitterm/agent-runtime/opencode-credentials";

/** The client ID workspaces present when refreshing; their workspace identity is the secret. */
export const MCP_OAUTH_WORKSPACE_CLIENT = "gitterm-workspace";

export type McpWorkspaceConnection = {
  connectionId: string;
  name: string;
  url: string;
  codemode: boolean;
  headers: Record<string, string>;
  /** Set for OAuth connections: OpenCode refreshes their tokens through GitTerm. */
  oauthMetadataUrl?: string;
};

/** The integration OpenCode registers for a remote MCP server, which holds its credential. */
export function opencodeMcpIntegrationId(name: string, url: string): string {
  return `mcp_${createHash("sha1").update(`${name}\u0000${url}`).digest("hex").slice(0, 16)}`;
}

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
): {
  config: Record<string, unknown> | null | undefined;
  env: Record<string, string>;
  credentials: OpencodeCredentialEntry[];
} {
  const env: Record<string, string> = {};
  const credentials: OpencodeCredentialEntry[] = [];
  if (!connections.length) return { config, env, credentials };
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
    if (connection.oauthMetadataUrl) {
      // OpenCode refreshes this placeholder against GitTerm, which keeps the real refresh token.
      // The workspace identity authenticates the refresh.
      credentials.push({
        integration: opencodeMcpIntegrationId(name, connection.url),
        label: OPENCODE_CREDENTIAL_LABEL,
        value: { type: "oauth", refresh: connection.connectionId, access: "", expires: 0 },
      });
    }
    servers[name] = {
      type: "remote",
      url: connection.url,
      oauth: connection.oauthMetadataUrl
        ? {
            client_id: MCP_OAUTH_WORKSPACE_CLIENT,
            client_secret: "{env:WORKSPACE_AGENT_AUTH_TOKEN}",
            auth_server_metadata_url: connection.oauthMetadataUrl,
          }
        : false,
      codemode: connection.codemode,
      protocol: "legacy",
      // A resumed VM retains Bun's HTTP pool, but its old TCP connections are
      // gone. Close each HTTP connection instead of reusing a frozen socket.
      headers: { ...headers, Connection: "close" },
    };
  }
  return { config: { ...config, mcp: { ...mcp, servers } }, env, credentials };
}
