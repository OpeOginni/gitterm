import type { ImageProviderMetadata } from "@gitterm/db/schema/cloud";

export const IMAGE_PROVIDER_KEYS = [
  "e2b",
  "aws",
  "daytona",
  "cloudflare",
  "vercel",
  "ascii",
  "exedev",
  "railway",
] as const;

export type ImageProviderKey = (typeof IMAGE_PROVIDER_KEYS)[number];

export function getSupportedImageProviders(
  metadata: ImageProviderMetadata | null | undefined,
): ImageProviderKey[] {
  return IMAGE_PROVIDER_KEYS.filter((key) => imageSupportsProvider(key, metadata));
}

function supportedProviderCount(metadata: ImageProviderMetadata | null | undefined): number {
  return getSupportedImageProviders(metadata).length;
}

/**
 * Choose the catalog image to run on a provider. Several images may exist per
 * agent type; the one built for the fewest providers wins (e.g. an AWS-only
 * image beats the general server image on AWS), then the most recently updated.
 */
export function pickImageForProvider<
  T extends { providerMetadata?: ImageProviderMetadata | null; updatedAt: Date },
>(images: T[], providerKey: string): T | undefined {
  return images
    .filter((candidate) => imageSupportsProvider(providerKey, candidate.providerMetadata))
    .toSorted(
      (a, b) =>
        supportedProviderCount(a.providerMetadata) - supportedProviderCount(b.providerMetadata) ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    )[0];
}

export function imageSupportsProvider(
  providerKey: string,
  metadata: ImageProviderMetadata | null | undefined,
): boolean {
  switch (providerKey.toLowerCase()) {
    case "e2b":
      return Boolean(metadata?.e2b?.templateId);
    case "aws":
      return Boolean(metadata?.aws);
    case "daytona":
      return Boolean(metadata?.daytona);
    case "cloudflare":
      return Boolean(metadata?.cloudflare?.startCommand && metadata.cloudflare.port);
    case "vercel":
      return Boolean(metadata?.vercel?.image || metadata?.vercel?.runtime);
    case "ascii":
      return Boolean(metadata?.ascii?.setupCommands?.length);
    case "exedev":
      return Boolean(metadata?.exedev);
    case "railway":
      return Boolean(metadata?.railway);
    case "local":
      return true;
    default:
      return false;
  }
}
