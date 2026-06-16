/**
 * Cloudflare Sandbox provider configuration.
 *
 * The worker is deployed manually by the admin (see the provider page). GitTerm
 * only stores where it lives and the shared secret to talk to it.
 */
export interface CloudflareConfig {
  /** Deployed compute worker URL, e.g. https://gitterm-sandbox.acct.workers.dev */
  workerUrl?: string;
  /** Shared secret authenticating GitTerm <-> worker (control + proxy). */
  internalApiKey?: string;
  /** Legacy: callback secret for the agent-loop worker. */
  callbackSecret?: string;
}

/** Config guaranteed to have the fields the compute provider needs at runtime. */
export interface ResolvedCloudflareComputeConfig {
  workerUrl: string;
  internalApiKey: string;
}
