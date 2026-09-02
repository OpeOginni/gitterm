import { describe, expect, test } from "bun:test";
import { workspaceSecretFilesSchema, workspaceSetupSchema } from "./workspace-setup";

describe("hosted workspace capabilities", () => {
  test("accepts phased setup", () => {
    expect(
      workspaceSetupSchema.parse({ beforeAgent: ["bun install"], afterAgent: ["bun test"] }),
    ).toEqual({ beforeAgent: ["bun install"], afterAgent: ["bun test"] });
  });

  test("restricts secret files to safe repository paths and modes", () => {
    expect(workspaceSecretFilesSchema.parse([{ path: ".env", content: "value" }])[0]?.mode).toBe(
      "0600",
    );
    for (const path of ["/tmp/key", "../key", ".git/config", ".gitterm/state", "a//b"]) {
      expect(() => workspaceSecretFilesSchema.parse([{ path, content: "value" }])).toThrow();
    }
    expect(() =>
      workspaceSecretFilesSchema.parse([{ path: "key", content: "value", mode: "0777" }]),
    ).toThrow();
  });
});
