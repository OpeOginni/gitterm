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
  const { config, env } = withMcpConnections(original, connections);
  expect(Object.keys(original.mcp.servers)).toHaveLength(1);
  expect(config!.model).toBe("p/m");
  const mcp = config!.mcp as typeof original.mcp;
  expect(mcp.timeout).toEqual({ catalog: 5000 });
  expect(Object.keys(mcp.servers)).toHaveLength(3);
  expect(Object.values(mcp.servers).map((server) => server.url)).toContain(
    "https://first.example/mcp",
  );
  expect(JSON.stringify(config)).not.toContain("first-secret");
  expect(JSON.stringify(config)).not.toContain("second-secret");
  expect(Object.values(env)).toEqual(["Bearer first-secret", "second-secret"]);
  expect(Object.keys(env)).toHaveLength(2);
  expect(JSON.stringify(config)).not.toContain("/relay/");
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
test("never silently overwrites a conflicting server name", () => {
  const name = `gitterm_${connections[0]!.connectionId.replace(/-/g, "_")}`;
  expect(() => withMcpConnections({ mcp: { servers: { [name]: {} } } }, connections)).toThrow(
    "conflicts",
  );
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
  expect(configText).not.toContain("first-secret");
  const servers = Object.values(JSON.parse(configText).mcp.servers) as Record<string, any>[];
  expect(servers).toHaveLength(2);
  expect(servers[0]!.oauth).toBe(false);
  expect(servers[0]!.protocol).toBe("legacy");
  expect(servers[1]!.codemode).toBe(false);
  for (const server of servers) {
    for (const reference of Object.values(server.headers) as string[]) {
      expect(reference).toMatch(/^\{env:GITTERM_MCP_[\w]+\}$/);
      expect(result.env[reference.slice(5, -1)]).toBeTruthy();
    }
  }
});
test("no-auth servers do not mint credentials, and no attachments leave user configuration alone", () => {
  const original = { mcp: { timeout: { catalog: 10000 } } };
  expect(withMcpConnections(original, []).config).toBe(original);
  const result = withMcpConnections(undefined, [{ ...connections[0]!, headers: {} }]);
  expect(result.env).toEqual({});
  expect(Object.values((result.config!.mcp as any).servers)[0]).not.toHaveProperty("headers");
});
