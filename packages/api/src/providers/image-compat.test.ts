import { describe, expect, test } from "bun:test";
import { imageSupportsProvider } from "./image-compat";

describe("imageSupportsProvider", () => {
  test("requires an Ascii agent setup command", () => {
    expect(imageSupportsProvider("ascii", { ascii: {} })).toBe(false);
    expect(
      imageSupportsProvider("ascii", {
        ascii: { setupCommands: ["npm install -g opencode-ai"] },
      }),
    ).toBe(true);
  });
});
