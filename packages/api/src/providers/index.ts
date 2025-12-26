import type { ComputeProvider } from "./compute";
import { railwayProvider } from "./railway";
import { localProvider } from "./local";
import {
  enabledProviders,
  defaultProvider,
  isProviderEnabled,
} from "../config/deployment";

export * from "./compute";
export { railwayProvider } from "./railway";
export { localProvider } from "./local";

/**
 * All available provider implementations
 * New providers should be added here
 */
const availableProviders: Record<string, ComputeProvider> = {
  railway: railwayProvider,
  local: localProvider,
  // Future providers:
  // docker: dockerProvider,
  // kubernetes: kubernetesProvider,
};

/**
 * Get enabled providers based on ENABLED_PROVIDERS env var
 * Returns only providers that are both available and enabled
 */
function getEnabledProviders(): Record<string, ComputeProvider> {
  const enabled: Record<string, ComputeProvider> = {};

  // Always include 'local' as it's a fallback for tunnel-only mode
  enabled.local = localProvider;

  for (const providerName of enabledProviders) {
    const provider = availableProviders[providerName];
    if (provider) {
      enabled[providerName] = provider;
    } else if (providerName !== "local") {
      console.warn(
        `[providers] Provider "${providerName}" is enabled but not implemented. Available: ${Object.keys(availableProviders).join(", ")}`
      );
    }
  }

  return enabled;
}

// Cached enabled providers
const providers = getEnabledProviders();

/**
 * Get a compute provider by name
 * @throws Error if provider is not enabled or doesn't exist
 */
export function getProvider(name: string): ComputeProvider {
  const normalizedName = name.toLowerCase();

  // Check if provider exists in available providers
  const provider = availableProviders[normalizedName];
  if (!provider) {
    throw new Error(
      `Unknown compute provider: ${name}. Available: ${Object.keys(availableProviders).join(", ")}`
    );
  }

  // Check if provider is enabled
  if (!isProviderEnabled(normalizedName) && normalizedName !== "local") {
    throw new Error(
      `Compute provider "${name}" is not enabled. Enabled providers: ${enabledProviders.join(", ")}`
    );
  }

  return provider;
}

/**
 * Get the default compute provider
 */
export function getDefaultProvider(): ComputeProvider {
  return getProvider(defaultProvider);
}

/**
 * Get all enabled provider names
 */
export function getEnabledProviderNames(): string[] {
  return Object.keys(providers);
}

/**
 * Check if a provider is available and enabled
 */
export function isProviderAvailable(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return normalizedName in providers;
}

/**
 * Get a compute provider by cloud provider ID from database
 */
export async function getProviderByCloudProviderId(
  cloudProviderName: string
): Promise<ComputeProvider> {
  return getProvider(cloudProviderName);
}

