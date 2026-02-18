import type { ComputeProvider } from "./compute";
import { railwayProvider } from "./railway";

export * from "./compute";
export { railwayProvider } from "./railway";

/**
 * All available provider implementations
 * Providers are managed via the database (seeded on first run, admin can enable/disable)
 * This map contains the actual implementation for each provider type
 */
const availableProviders: Record<string, ComputeProvider> = {
  railway: railwayProvider,
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
 * Get a compute provider by cloud provider name from database
 */
export async function getProviderByCloudProviderId(
  cloudProviderName: string,
): Promise<ComputeProvider> {
  return getProvider(cloudProviderName);
}
