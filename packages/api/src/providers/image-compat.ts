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
    case "cloudflare":
      return Boolean(metadata?.cloudflare?.startCommand && metadata.cloudflare.port);
    case "vercel":
      return Boolean(metadata?.vercel?.image || metadata?.vercel?.runtime);
    case "upstash":
      return Boolean(metadata?.upstash?.runtime);
    case "ascii":
      return Boolean(metadata?.ascii?.setupCommands?.length);
    case "exedev":
      return Boolean(metadata?.exedev);
    case "railway":
    case "local":
      return true;
    default:
      return false;
  }
}
