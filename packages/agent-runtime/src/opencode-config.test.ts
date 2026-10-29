import { expect, test } from "bun:test";
import { buildOpencodeCliConfig, buildOpencodeConfig } from "./opencode-config";

test("native plugin options and permission rules survive merging", () => {
  const configured = { package: "example", options: { enabled: true } };
  const input = {
    theme: "tokyonight",
    plugins: [configured, "second"],
    permissions: [{ action: "external_directory", resource: "*", effect: "ask" }],
    mcp: { servers: {} },
  };
  expect(buildOpencodeConfig(input, ["example", "third"])).toEqual({
    $schema: "https://opencode.ai/config.json",
    plugins: [configured, "second", "third"],
    permissions: input.permissions,
    mcp: input.mcp,
  });
  expect(input.theme).toBe("tokyonight");
  expect(buildOpencodeCliConfig(input)).toEqual({
    $schema: "https://opencode.ai/v2/cli.json",
    theme: { name: "tokyonight" },
  });
});
