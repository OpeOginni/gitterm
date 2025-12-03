import type { ComputeProvider } from "./compute";
import { railwayProvider } from "./railway";

export * from "./compute";
export { railwayProvider } from "./railway";

const providers: Record<string, ComputeProvider> = {
  railway: railwayProvider,
};

/**
 * Get a compute provider by name
 */
export function getProvider(name: string): ComputeProvider {
  const provider = providers[name.toLowerCase()];
  if (!provider) {
    throw new Error(`Unknown compute provider: ${name}`);
  }
  return provider;
}

/**
 * Get a compute provider by cloud provider ID from database
 */
export async function getProviderByCloudProviderId(
  cloudProviderName: string
): Promise<ComputeProvider> {
  // Map cloud provider names to provider implementations
  const providerMap: Record<string, ComputeProvider> = {
    railway: railwayProvider,
    // Future: aws: awsProvider, azure: azureProvider
  };

  const provider = providerMap[cloudProviderName.toLowerCase()];
  if (!provider) {
    throw new Error(`No compute provider implementation for: ${cloudProviderName}`);
  }

  return provider;
}

