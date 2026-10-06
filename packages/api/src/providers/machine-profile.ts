import type { ImageProviderMetadata, MachineSelectionPolicy } from "@gitterm/db/schema/cloud";

export function applyMachineProfile(
  metadata: ImageProviderMetadata,
  providerKey: string,
  options: Record<string, unknown> | undefined,
): ImageProviderMetadata {
  if (!options || Object.keys(options).length === 0) return metadata;
  const providerMetadata = metadata[providerKey];
  return {
    ...metadata,
    [providerKey]: {
      ...(providerMetadata && typeof providerMetadata === "object" ? providerMetadata : {}),
      ...options,
    },
  };
}

/** Which of a provider's sizes a plan may use: all of them, or only the smallest. */
export type MachineAccess = "any" | "smallest";

interface MachineProfileLike {
  id: string;
  key: string;
  isDefault: boolean;
  vcpus: number | null;
  memoryGb: number | null;
}

const sizeOf = (profile: MachineProfileLike) =>
  [profile.vcpus ?? Infinity, profile.memoryGb ?? Infinity] as const;

/**
 * The machine profiles a user may create workspaces with. The admin's policy
 * applies first ("standard" pins the provider's default size), then the plan.
 * `profiles` are the provider's enabled profiles, default first.
 */
export function getSelectableMachineProfiles<T extends MachineProfileLike>(
  profiles: T[],
  mode: MachineSelectionPolicy["mode"],
  access: MachineAccess,
): T[] {
  const pinned = getDefaultMachineProfile(profiles);
  const byPolicy = mode === "standard" ? (pinned ? [pinned] : []) : profiles;
  if (access === "any") return byPolicy;

  const smallest = byPolicy.reduce<T | undefined>((current, profile) => {
    if (!current) return profile;
    const [cpu, memory] = sizeOf(profile);
    const [currentCpu, currentMemory] = sizeOf(current);
    return cpu < currentCpu || (cpu === currentCpu && memory < currentMemory) ? profile : current;
  }, undefined);
  return smallest ? [smallest] : [];
}

/** The profile used when the user does not pick one. */
export function getDefaultMachineProfile<T extends MachineProfileLike>(
  selectable: T[],
): T | undefined {
  return selectable.find((profile) => profile.isDefault) ?? selectable[0];
}
