import { describe, expect, test } from "bun:test";
import { removeRetiredImageProviders } from "@gitterm/db/seed-image-cleanup";
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
        ascii: { setupCommands: ["npm install -g @opencode/cli@2"] },
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

  test("seed cleanup stops the legacy SSH image from shadowing the general E2B image", () => {
    const legacySsh = {
      name: "gitterm-opencode-server-with-ssh",
      providerMetadata: {
        e2b: { templateId: "nxiezl38gnw32ufyloc0" },
        daytona: { image: "opeoginni/gitterm-opencode-server-with-ssh:latest" },
      },
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    expect(pickImageForProvider([general, legacySsh], "e2b")?.name).toBe(legacySsh.name);

    const cleaned = {
      ...legacySsh,
      providerMetadata: removeRetiredImageProviders(legacySsh.name, legacySsh.providerMetadata),
    };
    expect(pickImageForProvider([general, cleaned], "e2b")?.name).toBe(general.name);
    expect(pickImageForProvider([general, cleaned], "daytona")?.name).toBe(legacySsh.name);
  });
});
