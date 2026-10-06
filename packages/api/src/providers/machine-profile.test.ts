import { describe, expect, test } from "bun:test";
import {
  applyMachineProfile,
  getDefaultMachineProfile,
  getSelectableMachineProfiles,
} from "./machine-profile";

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
    const metadata = { e2b: { templateId: "template" } };
    expect(applyMachineProfile(metadata, "e2b", undefined)).toBe(metadata);
  });
});

describe("getSelectableMachineProfiles", () => {
  const profile = (
    key: string,
    vcpus: number | null,
    memoryGb: number | null,
    isDefault = false,
  ) => ({
    id: key,
    key,
    isDefault,
    vcpus,
    memoryGb,
  });
  const standard = profile("standard", 4, 8, true);
  const small = profile("small", 2, 4);
  const large = profile("large", 8, 16);
  const profiles = [standard, large, small];

  test("lets paid plans pick any size", () => {
    expect(getSelectableMachineProfiles(profiles, "profiles", "any")).toEqual(profiles);
  });

  test("limits free plans to the smallest size", () => {
    expect(getSelectableMachineProfiles(profiles, "profiles", "smallest")).toEqual([small]);
  });

  test("treats unknown sizes as larger than known ones", () => {
    const unknown = profile("custom", null, null);
    expect(getSelectableMachineProfiles([unknown, standard], "profiles", "smallest")).toEqual([
      standard,
    ]);
  });

  test("pins the admin's default size", () => {
    expect(getSelectableMachineProfiles(profiles, "standard", "any")).toEqual([standard]);
    expect(getSelectableMachineProfiles(profiles, "standard", "smallest")).toEqual([standard]);
  });

  test("defaults to the first profile when none is marked default", () => {
    expect(getSelectableMachineProfiles([large, small], "standard", "any")).toEqual([large]);
    expect(getDefaultMachineProfile([large, small])).toBe(large);
    expect(getDefaultMachineProfile([small, standard])).toBe(standard);
  });
});
