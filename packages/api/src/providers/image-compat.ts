import type { ImageProviderMetadata } from "@gitterm/db/schema/cloud";

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
    default:
      return true; // local / unknown providers don't need metadata
  }
}
