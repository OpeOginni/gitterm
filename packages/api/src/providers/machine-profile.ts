import type { ImageProviderMetadata } from "@gitterm/db/schema/cloud";

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
