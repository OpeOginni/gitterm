import type { ComputeProvider } from "./compute";
import { railwayProvider } from "./railway";
import { localProvider } from "./local";

export * from "./compute";
export { railwayProvider } from "./railway";
export { localProvider } from "./local";

const providers: Record<string, ComputeProvider> = {
  railway: railwayProvider,
  local: localProvider,
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
    local: localProvider,
    // Future: aws: awsProvider, azure: azureProvider
  };

  const provider = providerMap[cloudProviderName.toLowerCase()];
  if (!provider) {
    throw new Error(`No compute provider implementation for: ${cloudProviderName}`);
  }

  return provider;
}

