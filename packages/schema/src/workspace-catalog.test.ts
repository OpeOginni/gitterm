import { describe, expect, test } from "bun:test";
import { parseProviderMachineOptions, workspaceProviderSelectionSchema } from "./workspace-catalog";

describe("workspace catalog schemas", () => {
  test("validates provider-specific machine settings", () => {
    expect(parseProviderMachineOptions("exedev", { cpu: 4, memory: "8GB" })).toEqual({
      cpu: 4,
      memory: "8GB",
    });
  });

  test("only accepts regions for region-selectable provider shapes", () => {
    expect(workspaceProviderSelectionSchema.parse({ type: "aws", region: "us-east-1" })).toEqual({
      type: "aws",
      region: "us-east-1",
    });
    expect(() =>
      workspaceProviderSelectionSchema.parse({ type: "e2b", region: "us-east-1" }),
    ).toThrow();
  });
});
