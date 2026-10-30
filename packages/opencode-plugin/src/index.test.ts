import { expect, test } from "bun:test";
import { GittermCloudPlugin } from "./index";

test("registers /cloud and separate sandbox tools", async () => {
  const commands: string[] = [];
  const tools: string[] = [];
  type Context = Parameters<typeof GittermCloudPlugin.setup>[0];
  type Transform = Context["command"]["transform"];
  type ToolTransform = Context["tool"]["transform"];
  const context = {
    options: {},
    command: {
      transform: async (transform: Parameters<Transform>[0]) => {
        transform({
          add: (definition) => {
            commands.push(definition.name);
          },
        } as Parameters<Parameters<Transform>[0]>[0]);
      },
    },
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
  const cleanup = await GittermCloudPlugin.setup(context);
  try {
    expect(commands).toEqual(["cloud"]);
    expect(tools).toEqual([
      "sandbox_account",
      "sandbox_create",
      "sandbox_list",
      "sandbox_sync",
      "sandbox_exec",
      "sandbox_job",
      "sandbox_cancel",
      "sandbox_preview",
      "sandbox_artifact",
      "sandbox_apply",
      "sandbox_destroy",
    ]);
  } finally {
    if (cleanup) await cleanup();
  }
});
