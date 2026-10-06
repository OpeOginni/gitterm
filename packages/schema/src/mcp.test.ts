import { expect, test } from "bun:test";
import { mcpConnectionInput, mcpEndpoint, mcpHeaders } from "./mcp";

test.each([
  "",
  "not a url",
  "https://",
  "https://v2.executor.sh/org/<organization-id-or-slug>/mcp",
])("malformed URLs and placeholders produce validation errors instead of throwing: %s", (url) => {
  expect(mcpEndpoint.safeParse(url).success).toBe(false);
});

test.each([
  "http://example.com/mcp",
  "https://user:password@example.com/mcp",
  "https://example.com/mcp#secret",
  "https://example.com/mcp?access_token=secret",
  "file:///etc/passwd",
])("rejects unsafe MCP endpoint %s", (url) => {
  expect(mcpEndpoint.safeParse(url).success).toBe(false);
});
test("supports a custom server and Executor through the same schema", () => {
  for (const integration of ["mcp", "executor"] as const) {
    expect(
      mcpConnectionInput.parse({
        integration,
        name: "Tools",
        url: "https://example.com/mcp",
        authentication: { type: "none" },
      }).codemode,
    ).toBe(true);
  }
});
test.each([
  "Cookie",
  "Host",
  "Content-Length",
  "Mcp-Session-Id",
  "X-Forwarded-For",
  "Proxy-Authorization",
])("blocks transport or identity header %s", (name) => {
  expect(mcpHeaders.safeParse({ [name]: "value" }).success).toBe(false);
});
test("rejects header injection, duplicate casing, empty credentials and oversized catalogs", () => {
  expect(mcpHeaders.safeParse({ Authorization: "Bearer token\r\nInjected: header" }).success).toBe(
    false,
  );
  expect(mcpHeaders.safeParse({ Authorization: "one", authorization: "two" }).success).toBe(false);
  expect(mcpHeaders.safeParse({ "X-API-Key": "" }).success).toBe(false);
  expect(
    mcpHeaders.safeParse(
      Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`X-Key-${i}`, "v"])),
    ).success,
  ).toBe(false);
  expect(
    mcpHeaders.safeParse({ Authorization: "Bearer token", "X-Executor-Organization": "org" })
      .success,
  ).toBe(true);
});
test("managed OAuth is explicitly outside the thin connection API", () => {
  expect(
    mcpConnectionInput.safeParse({
      integration: "mcp",
      name: "Tools",
      url: "https://example.com/mcp",
      authentication: { type: "oauth" },
    }).success,
  ).toBe(false);
});
