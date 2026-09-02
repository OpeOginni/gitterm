import { describe, expect, test } from "bun:test";
import { createGittermClient } from "./client";
import type { WorkspaceCreateInput, WorkspaceProviderSelection } from "./types";

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
  machine: { type: "profile", key: "rendering" },
};

// @ts-expect-error E2B placement does not accept a caller-selected region.
const invalidE2bSelection: WorkspaceProviderSelection = { type: "e2b", region: "us-east-1" };

const invalidE2bMachine: WorkspaceProviderSelection = {
  type: "e2b",
  // @ts-expect-error E2B templates are profile-only; custom CPU/RAM is unsupported.
  machine: { type: "custom", resources: { cpu: 4 } },
};

test("provider selections retain their discriminated fields", () => {
  expect(awsSelection.type === "aws" && awsSelection.region).toBe("us-east-1");
  expect(invalidE2bSelection.type).toBe("e2b");
  expect(invalidE2bMachine.type).toBe("e2b");
});

const phasedSetup: WorkspaceCreateInput = {
  repo: "https://github.com/gitterm/example",
  setup: { beforeAgent: ["bun install"], afterAgent: ["bun test"] },
  secretFiles: [{ path: ".env", content: "TOKEN=secret", mode: "0400" }],
};

test("hosted workspace input exposes phased setup and strict secret modes", () => {
  expect(phasedSetup.setup?.beforeAgent).toEqual(["bun install"]);
  expect(phasedSetup.secretFiles?.[0]?.mode).toBe("0400");
});
