import { describe, expect, test } from "bun:test";
import { createGittermClient } from "./client";
import type { WorkspaceProviderSelection } from "./types";

describe("createGittermClient", () => {
  test("uses the hosted API when only a token is supplied", () => {
    const client = createGittermClient({
      token: "gt_test",
      configPath: "/path/that/does/not/exist",
    });
    expect(client.serverUrl).toBe("https://api.gitterm.dev");
  });
});

const awsSelection: WorkspaceProviderSelection = {
  type: "aws",
  region: "us-east-1",
  machine: "rendering",
};

// @ts-expect-error E2B placement does not accept a caller-selected region.
const invalidE2bSelection: WorkspaceProviderSelection = { type: "e2b", region: "us-east-1" };

test("provider selections retain their discriminated fields", () => {
  expect(awsSelection.region).toBe("us-east-1");
  expect(invalidE2bSelection.type).toBe("e2b");
});
