import { describe, expect, test } from "bun:test";
import { parseProviderMachineOptions, workspaceProviderSelectionSchema } from "./workspace-catalog";

describe("workspace catalog schemas", () => {
  test("AWS access profile selection accepts IDs, not arbitrary role ARNs or non-AWS providers", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(workspaceProviderSelectionSchema.parse({ type: "aws", accessProfile: id })).toEqual({
      type: "aws",
      accessProfile: id,
    });
    expect(() =>
      workspaceProviderSelectionSchema.parse({
        type: "aws",
        accessProfile: "arn:aws:iam::123456789012:role/Admin",
      }),
    ).toThrow();
    expect(() =>
      workspaceProviderSelectionSchema.parse({ type: "e2b", accessProfile: id }),
    ).toThrow();
    expect(() =>
      workspaceProviderSelectionSchema.parse({
        type: "aws",
        taskRoleArn: "arn:aws:iam::123456789012:role/Admin",
      }),
    ).toThrow();
  });
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
