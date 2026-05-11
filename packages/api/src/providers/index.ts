import type { ComputeProvider } from "./compute";
import { awsProvider } from "./aws";
import { daytonaProvider } from "./daytona";
import { e2bProvider } from "./e2b";
import { railwayProvider } from "./railway";

export * from "./compute";
export { awsProvider } from "./aws";
export { railwayProvider } from "./railway";
export { e2bProvider } from "./e2b";

/**
 * All available provider implementations
 * Providers are managed via the database (seeded on first run, admin can enable/disable)
 * This map contains the actual implementation for each provider type
 *
 */
const availableProviders: Record<string, ComputeProvider> = {
  aws: awsProvider,
  railway: railwayProvider,
  e2b: e2bProvider,
  daytona: daytonaProvider,
  // Future providers:
  // docker: dockerProvider,
  // kubernetes: kubernetesProvider,
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
): Promise<ComputeProvider> {
  return getProvider(cloudProviderKey);
}
