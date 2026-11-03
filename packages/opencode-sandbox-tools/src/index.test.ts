import { expect, test } from "bun:test";
import { GittermSandboxToolsPlugin } from "./index";

test("registers the sandbox tools and no commands", async () => {
  const tools: string[] = [];
  type Context = Parameters<typeof GittermSandboxToolsPlugin.setup>[0];
  type ToolTransform = Context["tool"]["transform"];
  const context = {
    options: {},
    tool: {
      transform: async (transform: Parameters<ToolTransform>[0]) => {
        transform({
          namespace: () => {},
          add: (definition: { name: string }) => {
            tools.push(definition.name);
          },
        } as unknown as Parameters<Parameters<ToolTransform>[0]>[0]);
      },
    },
  } as unknown as Context;
  const cleanup = await GittermSandboxToolsPlugin.setup(context);
  try {
    expect(tools).toEqual([
      "sandbox_create",
      "sandbox_list",
      "sandbox_sync",
      "sandbox_exec",
      "sandbox_job",
      "sandbox_preview",
      "sandbox_artifact",
      "sandbox_apply",
      "sandbox_destroy",
    ]);
  } finally {
    if (cleanup) await cleanup();
  }
});
