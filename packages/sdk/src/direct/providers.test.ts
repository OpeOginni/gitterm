import { describe, expect, test } from "bun:test";
import { createDirectGittermClient } from "./client";
import type { DirectProviderConfig } from "./types";

const configs: DirectProviderConfig[] = [
  { type: "e2b", apiKey: "key", templateId: "template" },
  { type: "daytona", apiKey: "key", target: "us" },
  { type: "vercel", apiToken: "key", teamId: "team", projectId: "project" },
  { type: "ascii", apiKey: "key" },
  { type: "exedev", apiToken: "key" },
  {
    type: "railway",
    apiToken: "key",
    projectId: "project",
    environmentId: "environment",
  },
];

describe("built-in direct providers", () => {
  test("all provider configs resolve through the standard client", () => {
    expect(
      configs.map((config) => createDirectGittermClient({ provider: config }).provider.name),
    ).toEqual(["e2b", "daytona", "vercel", "ascii", "exedev", "railway"]);
  });

  test("all providers declare coherent lifecycle capabilities", () => {
    for (const config of configs) {
      const capabilities = createDirectGittermClient({ provider: config }).provider.capabilities;
      expect(capabilities.ephemeralPause === "unsupported").toBe(!capabilities.supportsPause);
    }
  });
});
