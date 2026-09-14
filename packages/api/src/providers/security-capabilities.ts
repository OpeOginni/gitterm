import { PROVIDER_KEYS, type ProviderKey } from "@gitterm/schema";

export type RuntimeSecretTransport =
  | "gitterm-broker"
  | "provider-secret-store"
  | "provider-sandbox-api";

export interface ProviderSecurityCapabilities {
  runtimeSecretTransport: RuntimeSecretTransport;
  /** Secret bytes are written outside the repository/persistent workspace volume. */
  runtimeOnlySecretFiles: boolean;
  /** Provider control-plane APIs receive raw runtime values during provisioning. */
  providerReceivesRawSecrets: boolean;
  cleanup: "workspace-lifecycle" | "provider-lifecycle";
}

export const PROVIDER_SECURITY_CAPABILITIES: Record<ProviderKey, ProviderSecurityCapabilities> = {
  railway: {
    runtimeSecretTransport: "gitterm-broker",
    runtimeOnlySecretFiles: true,
    providerReceivesRawSecrets: false,
    cleanup: "workspace-lifecycle",
  },
  aws: {
    runtimeSecretTransport: "provider-secret-store",
    runtimeOnlySecretFiles: true,
    providerReceivesRawSecrets: true,
    cleanup: "workspace-lifecycle",
  },
  e2b: sandboxApi(),
  daytona: sandboxApi(),
  cloudflare: sandboxApi(),
  vercel: sandboxApi(),
  ascii: sandboxApi(),
  exedev: sandboxApi(),
};

function sandboxApi(): ProviderSecurityCapabilities {
  return {
    runtimeSecretTransport: "provider-sandbox-api",
    runtimeOnlySecretFiles: true,
    providerReceivesRawSecrets: true,
    cleanup: "provider-lifecycle",
  };
}

// Compile-time and runtime guard for additions to PROVIDER_KEYS.
void PROVIDER_KEYS;
