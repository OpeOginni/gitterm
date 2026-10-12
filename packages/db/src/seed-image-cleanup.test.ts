import { describe, expect, test } from "bun:test";
import { removeRetiredImageProviders } from "./seed-image-cleanup";

describe("removeRetiredImageProviders", () => {
  const legacyName = "gitterm-opencode-server-with-ssh";

  test("removes the legacy SSH image's E2B mapping without changing other metadata", () => {
    const metadata = {
      e2b: { templateId: "nxiezl38gnw32ufyloc0" },
      daytona: {
        image: "opeoginni/gitterm-opencode-server-with-ssh:latest",
        snapshot: "daytona-medium",
      },
      isDefault: true,
      customProvider: { image: "custom" },
    };

    const cleaned = removeRetiredImageProviders(legacyName, metadata);

    expect(cleaned).toEqual({
      daytona: metadata.daytona,
      isDefault: true,
      customProvider: metadata.customProvider,
    });
    expect(metadata.e2b.templateId).toBe("nxiezl38gnw32ufyloc0");
    expect(cleaned.daytona).toBe(metadata.daytona);
  });

  test("is idempotent and leaves already-cleaned metadata untouched", () => {
    const metadata = { daytona: { image: "custom-image", snapshot: "daytona-medium" } };
    expect(removeRetiredImageProviders(legacyName, metadata)).toBe(metadata);
    expect(removeRetiredImageProviders(legacyName, {})).toEqual({});
  });

  test("preserves the general image's normal and SSH templates", () => {
    const metadata = {
      e2b: {
        templateId: "brightoginni123/gitterm-opencode-server",
        sshTemplateId: "brightoginni123/gitterm-opencode-server-with-ssh",
      },
    };
    expect(removeRetiredImageProviders("gitterm-opencode-server", metadata)).toBe(metadata);
  });

  test("does not remove E2B from unrelated admin-created images", () => {
    const metadata = { e2b: { templateId: "custom-template" } };
    expect(removeRetiredImageProviders("custom-ssh-image", metadata)).toBe(metadata);
  });
});
