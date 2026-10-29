import { expect, test } from "bun:test";
import { validateOpenCodeConfig } from "./agent-config";

test("saved OpenCode configuration accepts V2 fields and the CLI theme", () => {
  expect(
    validateOpenCodeConfig({
      plugins: [{ package: "example", options: { enabled: true } }],
      permissions: [{ action: "shell", resource: "*", effect: "ask" }],
      agents: { reviewer: { system: "Review the changes", model: "openai/gpt-6.1-sol#high" } },
      mcp: { servers: { example: { type: "remote", url: "https://example.com/mcp" } } },
      compaction: { keep: { tokens: 8000 } },
      experimental: { background_compaction: true },
    }).success,
  ).toBe(true);
  expect(
    validateOpenCodeConfig({
      plugins: ["example"],
      theme: "opencode",
      permissions: [{ action: "edit", resource: "*", effect: "deny" }],
    }).success,
  ).toBe(true);
  expect(validateOpenCodeConfig({ permissions: "allow" }).success).toBe(false);
  expect(validateOpenCodeConfig({ plugin: ["example"] }).success).toBe(false);
});
