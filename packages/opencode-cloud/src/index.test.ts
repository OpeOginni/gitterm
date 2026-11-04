import { expect, test } from "bun:test";
import { GittermCloudPlugin } from "./index";

test("registers /cloud and no tools", async () => {
  const commands: string[] = [];
  type Context = Parameters<typeof GittermCloudPlugin.setup>[0];
  type Transform = Context["command"]["transform"];
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
      transform: async () => {
        throw new Error("The handoff plugin must not register tools");
      },
    },
  } as unknown as Context;
  const cleanup = await GittermCloudPlugin.setup(context);
  try {
    expect(commands).toEqual(["cloud"]);
  } finally {
    if (cleanup) await cleanup();
  }
});
