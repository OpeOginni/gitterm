import type { ImageProviderMetadata } from "./schema/cloud";

/** Provider mappings superseded by the general server image, not entire retired images. */
export const RETIRED_IMAGE_PROVIDERS: Record<string, readonly string[]> = {
  "gitterm-opencode-server-with-ssh": ["e2b"],
};

export function removeRetiredImageProviders(
  name: string,
  metadata: ImageProviderMetadata,
): ImageProviderMetadata {
  const providers = RETIRED_IMAGE_PROVIDERS[name];
  if (!providers?.some((provider) => Object.hasOwn(metadata, provider))) return metadata;

  const cleaned = { ...metadata };
  for (const provider of providers) delete cleaned[provider];
  return cleaned;
}
