import { describe, expect, test } from "bun:test";
import { applyMachineProfile } from "./machine-profile";

describe("applyMachineProfile", () => {
  test("overrides machine settings without removing image settings", () => {
    expect(
      applyMachineProfile(
        { exedev: { image: "ubuntu", cpu: 2, memory: "4GB" }, isDefault: true },
        "exedev",
        { cpu: 4, memory: "8GB", disk: "25GB" },
      ),
    ).toEqual({
      exedev: { image: "ubuntu", cpu: 4, memory: "8GB", disk: "25GB" },
      isDefault: true,
    });
  });

  test("returns the original metadata when no profile is selected", () => {
    const metadata = { upstash: { runtime: "node" as const, size: "small" as const } };
    expect(applyMachineProfile(metadata, "upstash", undefined)).toBe(metadata);
  });
});
