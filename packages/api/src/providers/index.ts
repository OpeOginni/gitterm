import type { ComputeProvider } from "./compute";
import { awsProvider, AwsProvider } from "./aws";
import { gittermProvider, TransportWorkspaceProvider } from "./transport-workspace";
import { withSandboxHandles } from "./sandbox-handles";

export * from "./compute";
export { awsProvider } from "./aws";
export { gittermProvider } from "./transport-workspace";

/**
 * All available provider implementations
 * Providers are managed via the database (seeded on first run, admin can enable/disable)
 * This map contains the actual implementation for each provider type
 *
 */
const availableProviders: Record<string, ComputeProvider> = {
  // Every provider below except AWS is only a sandbox transport.
  e2b: new TransportWorkspaceProvider("e2b", { label: "E2B" }),
  daytona: new TransportWorkspaceProvider("daytona", { label: "Daytona" }),
  vercel: new TransportWorkspaceProvider("vercel", { label: "Vercel" }),
  boat: new TransportWorkspaceProvider("boat", { label: "Boat" }),
  exedev: new TransportWorkspaceProvider("exedev", { label: "exe.dev" }),
  // gitterm.dev only: there is no cloud provider row for it elsewhere, so nothing offers it.
  gitterm: gittermProvider,
  aws: awsProvider,
};

/**
 * Get a compute provider by name
 * @throws Error if provider implementation doesn't exist
 */
export function getProvider(name: string): ComputeProvider {
  const normalizedName = name.toLowerCase();

  const provider = availableProviders[normalizedName];
  if (!provider) {
    throw new Error(
      `Unknown compute provider: ${name}. Available implementations: ${Object.keys(availableProviders).join(", ")}`,
    );
  }

  return provider;
}

/**
 * Get all available provider implementation names
 */
export function getAvailableProviderNames(): string[] {
  return Object.keys(availableProviders);
}

/**
 * Check if a provider implementation is available
 */
export function isProviderImplemented(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return normalizedName in availableProviders;
}

/**
 * Get a compute provider by cloud provider implementation key.
 *
 * Cloud providers are stored in the DB with both a display `name` and a
 * `providerKey`. The `providerKey` is what maps to a concrete implementation
 * (e.g. multiple cloud_provider rows can share `providerKey = "aws"` for
 * region-scoped AWS providers).
 */
export async function getProviderByCloudProviderId(
  cloudProviderKey: string,
  providerId?: string,
): Promise<ComputeProvider> {
  if (cloudProviderKey === "aws" && providerId)
    return withSandboxHandles(new AwsProvider(providerId), providerId);
  // Railway hosts only managed sandboxes, whose `sandbox:` handles `withSandboxHandles` serves.
  if (cloudProviderKey === "railway")
    return withSandboxHandles(
      new TransportWorkspaceProvider("railway", { label: "Railway" }),
      providerId,
    );
  return withSandboxHandles(getProvider(cloudProviderKey), providerId);
}
