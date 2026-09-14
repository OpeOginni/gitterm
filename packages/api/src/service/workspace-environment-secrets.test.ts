import { describe, expect, test } from "bun:test";
import {
  maskWorkspaceEnvironment,
  openWorkspaceEnvironment,
  sealWorkspaceEnvironment,
} from "./workspace-environment-secrets";

describe("workspace environment secret storage", () => {
  test("encrypts values at rest and masks API representations", () => {
    const stored = sealWorkspaceEnvironment({ API_TOKEN: "very-secret" });
    expect(JSON.stringify(stored)).not.toContain("very-secret");
    expect(openWorkspaceEnvironment(stored)).toEqual({ API_TOKEN: "very-secret" });
    expect(maskWorkspaceEnvironment(stored)).toEqual({ API_TOKEN: "[REDACTED]" });
  });
});
