import { expect, test } from "bun:test";
import { isPublicMcpAddress, resolveMcpEndpoint } from "./mcp-network";
import { mcpPublicConnection } from "./mcp";

test.each([
  "127.0.0.1",
  "10.0.0.1",
  "172.16.0.1",
  "192.168.1.1",
  "169.254.169.254",
  "100.64.0.1",
  "0.0.0.0",
  "::1",
  "fc00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "::ffff:169.254.169.254",
])("blocks private/reserved MCP test target %s", (address) =>
  expect(isPublicMcpAddress(address)).toBe(false),
);
test("recognizes public IPv4 and IPv6", () => {
  expect(isPublicMcpAddress("1.1.1.1")).toBe(true);
  expect(isPublicMcpAddress("2606:4700:4700::1111")).toBe(true);
});
test("blocks encoded localhost and cloud metadata before a test request", async () => {
  for (const url of [
    "https://127.0.0.1/mcp",
    "https://2130706433/mcp",
    "https://0x7f000001/mcp",
    "https://[::ffff:127.0.0.1]/mcp",
    "https://169.254.169.254/latest/meta-data",
  ])
    await expect(resolveMcpEndpoint(url)).rejects.toThrow("public addresses");
});
test("public connections never serialize ciphertext or credentials", () => {
  const row = {
    id: "id",
    userId: "user",
    integration: "mcp",
    name: "Tools",
    url: "https://example.com/mcp",
    authType: "headers",
    encryptedAuth: "SECRET-CIPHERTEXT",
    status: "needs_auth",
    codemode: true,
    toolCount: null,
    serverInfo: null,
    lastCheckedAt: null,
    connectedAt: new Date(),
    updatedAt: new Date(),
    revision: 1,
  } as const;
  const value = JSON.stringify(mcpPublicConnection(row));
  expect(value).not.toContain("SECRET-CIPHERTEXT");
  expect(value).not.toContain("encryptedAuth");
  expect(value).not.toContain("userId");
});
