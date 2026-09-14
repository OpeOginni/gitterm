import { describe, expect, test } from "bun:test";
import {
  getSupportedImageProviders,
  imageSupportsProvider,
  pickImageForProvider,
} from "./image-compat";

describe("imageSupportsProvider", () => {
  test("requires an Ascii agent setup command", () => {
    expect(imageSupportsProvider("ascii", { ascii: {} })).toBe(false);
    expect(
      imageSupportsProvider("ascii", {
        ascii: { setupCommands: ["npm install -g opencode-ai"] },
      }),
    ).toBe(true);
  });

  test("reports provider support using the same rules as image selection", () => {
    expect(
      getSupportedImageProviders({
        aws: { cpu: 1 },
        daytona: {},
        e2b: { templateId: "" },
        ascii: {},
      }),
    ).toEqual(["aws", "daytona"]);
  });
});

describe("pickImageForProvider", () => {
  const general = {
    name: "server",
    providerMetadata: { aws: { cpu: 1 }, daytona: {}, e2b: { templateId: "t" } } as any,
    updatedAt: new Date("2026-09-06T00:00:00Z"),
  };
  const awsOnly = {
    name: "server-aws",
    providerMetadata: { aws: { cpu: 1 } } as any,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };

  test("prefers the image built for the fewest providers", () => {
    expect(pickImageForProvider([general, awsOnly], "aws")?.name).toBe("server-aws");
    expect(pickImageForProvider([awsOnly, general], "daytona")?.name).toBe("server");
  });

  test("ignores images that do not support the provider", () => {
    expect(pickImageForProvider([awsOnly], "e2b")).toBeUndefined();
  });

  test("breaks ties by most recent update", () => {
    const older = { ...awsOnly, name: "older", updatedAt: new Date("2025-01-01T00:00:00Z") };
    expect(pickImageForProvider([older, awsOnly], "aws")?.name).toBe("server-aws");
  });
});
