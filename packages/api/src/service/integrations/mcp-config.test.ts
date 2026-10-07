import { expect, test } from "bun:test";
import { withMcpConnections, type McpWorkspaceConnection } from "./mcp-config";
import { opencodeProvisioner, OPENCODE_CONFIG_PATH } from "../agents/opencode";

const connections: McpWorkspaceConnection[] = [
  {
    connectionId: "11111111-1111-4111-8111-111111111111",
    name: "same name",
    url: "https://first.example/mcp",
    codemode: true,
    headers: { Authorization: "Bearer first-secret" },
  },
  {
    connectionId: "22222222-2222-4222-8222-222222222222",
    name: "same name",
    url: "https://second.example/mcp",
    codemode: false,
    headers: { "X-API-Key": "second-secret" },
  },
];
test("merges direct MCP connections without losing unrelated config or existing servers", () => {
  const original = {
    model: "p/m",
    permissions: [{ action: "*", effect: "ask" }],
    mcp: {
      timeout: { catalog: 5000 },
      servers: { custom: { type: "remote", url: "https://example.com/mcp" } },
    },
  };
  const { config } = withMcpConnections(original, connections);
  expect(Object.keys(original.mcp.servers)).toHaveLength(1);
  expect(config!.model).toBe("p/m");
  const mcp = config!.mcp as typeof original.mcp;
  expect(mcp.timeout).toEqual({ catalog: 5000 });
  expect(Object.values(mcp.servers).map((server) => server.url)).toEqual([
    "https://example.com/mcp",
    ...connections.map((connection) => connection.url),
  ]);
});
test("preserves legacy definitions, including OAuth, alongside new V2 entries", () => {
  const old = {
    type: "remote",
    url: "https://example.com",
    enabled: false,
    oauth: { clientId: "client-id" },
    headers: { "X-Test": "value" },
  };
  const { config } = withMcpConnections({ mcp: { old } }, connections);
  expect((config!.mcp as any).old).toEqual(old);
});
test("servers are named as the user saved them, suffixed only when a name is taken", () => {
  const { config } = withMcpConnections(undefined, [
    { ...connections[0]!, name: "Context7" },
    { ...connections[1]!, name: "Context7" },
    { ...connections[0]!, connectionId: "33333333-3333-4333-8333-333333333333", name: "!!" },
  ]);
  expect(Object.keys((config!.mcp as any).servers)).toEqual([
    "Context7",
    "Context7_22222222",
    "mcp_33333333",
  ]);
  expect(
    Object.keys((withMcpConnections(undefined, connections).config!.mcp as any).servers),
  ).toEqual(["same_name", "same_name_22222222"]);
});
test("never silently overwrites a conflicting server name", () => {
  const user = { type: "remote", url: "https://mine.example/mcp" };
  const { config } = withMcpConnections({ mcp: { servers: { same_name: user } } }, connections);
  const servers = (config!.mcp as any).servers;
  expect(servers.same_name).toBe(user);
  expect(servers.same_name_11111111.url).toBe(connections[0]!.url);
  const taken = { same_name_11111111: {}, same_name: {} };
  expect(() => withMcpConnections({ mcp: { servers: taken } }, connections)).toThrow("conflicts");
});
test("OpenCode gets credentials through isolated environment substitutions, not literal config", () => {
  const result = opencodeProvisioner.provision({
    userId: "u",
    userDisplayName: "User",
    workspaceHostname: "ws",
    agentTypeName: "OpenCode",
    serverOnly: true,
    credentials: [],
    mcpConnections: connections,
  });
  expect(Object.values(result.env)).toEqual(["Bearer first-secret", "second-secret"]);
  const configText = Buffer.from(
    result.files.find((file) => file.path === OPENCODE_CONFIG_PATH)!.contentBase64,
    "base64",
  ).toString();
  for (const connection of connections) {
    for (const secret of Object.values(connection.headers))
      expect(configText).not.toContain(secret);
  }
  const servers = Object.values(JSON.parse(configText).mcp.servers) as Record<string, any>[];
  expect(servers).toHaveLength(2);
  expect(servers[0]!.oauth).toBe(false);
  expect(servers[0]!.protocol).toBe("legacy");
  expect(servers[1]!.codemode).toBe(false);
  for (const [index, server] of servers.entries()) {
    expect(server.headers.Connection).toBe("close");
    for (const [name, reference] of Object.entries(server.headers) as [string, string][]) {
      if (name === "Connection") continue;
      expect(reference).toMatch(/^\{env:GITTERM_MCP_[\w]+\}$/);
      expect(result.env[reference.slice(5, -1)]).toBe(connections[index]!.headers[name]);
    }
  }
});
test("no-auth servers do not mint credentials, and no attachments leave user configuration alone", () => {
  const original = { mcp: { timeout: { catalog: 10000 } } };
  expect(withMcpConnections(original, []).config).toBe(original);
  const result = withMcpConnections(undefined, [{ ...connections[0]!, headers: {} }]);
  expect(result.env).toEqual({});
  expect(Object.values((result.config!.mcp as any).servers)[0]).toHaveProperty("headers", {
    Connection: "close",
  });
});
