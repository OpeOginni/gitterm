import { expect, test } from "bun:test";
import { GittermCloudPlugin } from "./index";

test("registers a single one-word command for handoff and reconnection", async () => {
  const names: string[] = [];
  type Context = Parameters<typeof GittermCloudPlugin.setup>[0];
  type Transform = Context["command"]["transform"];
  const context = {
    options: {},
    command: {
      transform: async (transform: Parameters<Transform>[0]) => {
        transform({
          add: (definition) => {
            names.push(definition.name);
          },
        });
      },
    },
  } as unknown as Context;
  const cleanup = await GittermCloudPlugin.setup(context);
  try {
    expect(names).toEqual(["cloud"]);
  } finally {
    if (cleanup) await cleanup();
  }
});
