import { createSandboxTransport } from "@gitterm/agent-runtime/sandbox/index";
import { SANDBOX_PROVIDER_PROFILES } from "@gitterm/agent-runtime/sandbox/types";
import { createGittermClient } from "../client.js";
import {
  createDirectSandboxBackend,
  createManagedSandboxBackend,
  validateAccountName,
  type SandboxBackend,
  type SandboxMode,
} from "./backend.js";
import type { SandboxLimits } from "./client.js";
import type { SandboxCapabilities, SandboxProviderKey } from "./types.js";

type DirectCredential = {
  /** The resolved credential (plugin options, after `{env:...}`/`{file:...}` substitution). */
  apiKey?: string;
  /** Name of an environment variable holding the credential (CLI settings file). */
  apiKeyEnv?: string;
  /**
   * Required for providers that never delete an abandoned sandbox themselves
   * (exe.dev, Railway): a crashed caller leaves it running until you destroy it.
   */
  allowUnboundedLifetime?: boolean;
};

/**
 * Account settings. In OpenCode they live in the plugin options, where
 * `"apiKey": "{env:E2B_API_KEY}"` is substituted by OpenCode before the plugin sees it.
 * The CLI reads the same shape from a file but takes credentials only from `apiKeyEnv`.
 */
export type SandboxAccountConfig =
  | ({
      mode: "direct";
      provider: "e2b";
      /** Defaults to `base` (no agent). */ template?: string;
    } & DirectCredential)
  | ({
      mode: "direct";
      provider: "daytona";
      target?: "us" | "eu";
      /** Daytona snapshot name. */ snapshot?: string;
    } & DirectCredential)
  | ({
      mode: "direct";
      provider: "vercel";
      teamId: string;
      projectId: string;
      runtime?: "node24" | "node22" | "python3.13";
    } & DirectCredential)
  | ({ mode: "direct"; provider: "boat"; size?: "small" | "default" | "large" } & DirectCredential)
  | ({
      mode: "direct";
      provider: "exedev";
      /** Container image; defaults to a plain Node image. */ image?: string;
    } & DirectCredential)
  | ({
      mode: "direct";
      provider: "railway";
      projectId: string;
      environmentId: string;
      apiUrl?: string;
      image?: string;
    } & DirectCredential)
  | {
      mode: "managed";
      /** Defaults to e2b. The deployment must enable sandboxes on it. */
      provider?: SandboxProviderKey;
      /** Defaults to the CLI login's server. */
      serverUrl?: string;
      /** Defaults to the CLI login or GITTERM_API_TOKEN. */
      token?: string;
    };

export type SandboxSettings = {
  /** Selected account name. */
  account?: string;
  accounts?: Record<string, SandboxAccountConfig>;
  limits?: Partial<SandboxLimits>;
  /** Extra glob patterns never uploaded. Secret-like files are always excluded. */
  exclude?: string[];
};

export type SandboxAccountSummary = {
  name: string;
  mode: SandboxMode;
  provider: SandboxProviderKey;
  /** Where the credential comes from. Never the credential itself. */
  credentialSource: string;
  credentialPresent: boolean;
  chargedTo: string;
  capabilities: SandboxCapabilities;
  /** Plain-language limits of this provider for sandboxes. */
  limitations: string[];
};

const DIRECT_PROVIDERS = ["e2b", "daytona", "vercel", "boat", "exedev", "railway"] as const;
const PROVIDER_NAMES: Record<SandboxProviderKey, string> = {
  e2b: "E2B",
  daytona: "Daytona",
  vercel: "Vercel",
  boat: "Boat",
  exedev: "exe.dev",
  railway: "Railway",
  aws: "AWS",
};

function selected(settings: SandboxSettings, accountName?: string) {
  const name = accountName ?? settings.account;
  const accounts = settings.accounts ?? {};
  if (!name) {
    const names = Object.keys(accounts);
    throw new Error(
      names.length
        ? `No sandbox account selected. Choose one of: ${names.join(", ")}.`
        : "No sandbox accounts are configured. Add one to the sandbox settings.",
    );
  }
  const config = accounts[validateAccountName(name)];
  if (!config) throw new Error(`Sandbox account ${JSON.stringify(name)} is not configured.`);
  const mode: string = config.mode;
  if (mode !== "direct" && mode !== "managed")
    throw new Error(`Sandbox account ${name} has an unknown mode.`);
  const provider: string = config.provider ?? "e2b";
  if (!Object.hasOwn(SANDBOX_PROVIDER_PROFILES, provider))
    throw new Error(
      `Sandbox account ${name} uses provider ${JSON.stringify(provider)}, which does not support sandboxes.`,
    );
  if (mode === "direct" && !(DIRECT_PROVIDERS as readonly string[]).includes(provider))
    throw new Error(
      `Sandbox account ${name}: ${provider} sandboxes are available only as a managed account.`,
    );
  return { name, config, provider: provider as SandboxProviderKey };
}

function directCredential(config: DirectCredential) {
  if (config.apiKey !== undefined) return { source: "plugin option", value: config.apiKey.trim() };
  if (config.apiKeyEnv)
    return {
      source: `environment variable ${config.apiKeyEnv}`,
      value: process.env[config.apiKeyEnv]?.trim() ?? "",
    };
  return { source: "not configured", value: "" };
}

export function describeLimitations(provider: SandboxProviderKey, mode: SandboxMode): string[] {
  const { capabilities } = SANDBOX_PROVIDER_PROFILES[provider];
  const name = PROVIDER_NAMES[provider];
  return [
    mode === "managed"
      ? "Gitterm terminates the sandbox at its lifetime, even if this machine is offline."
      : capabilities.expiry === "hard"
        ? `${name} deletes the sandbox at its lifetime, even if this machine is offline.`
        : capabilities.expiry === "idle"
          ? `${name} deletes the sandbox after it has been idle for its lifetime; an actively used sandbox can run longer.`
          : capabilities.expiry === "archive"
            ? `${name} stops and archives the sandbox at its lifetime; the archived storage remains until you destroy it.`
            : `${name} never deletes an abandoned sandbox. Destroy it yourself; a crash leaves it running and billing.`,
    capabilities.previews === "private"
      ? "Previews are private unless created with public previews."
      : capabilities.previews === "public"
        ? `${name} previews are always public URLs, so they need the public-sharing approval.`
        : `${name} sandboxes cannot expose ports.`,
    ...(capabilities.pause === "state-losing"
      ? [`Pausing a ${name} sandbox discards its files and processes.`]
      : []),
  ];
}

export function describeSandboxAccount(
  settings: SandboxSettings,
  accountName?: string,
): SandboxAccountSummary {
  const { name, config, provider } = selected(settings, accountName);
  const base = {
    name,
    provider,
    capabilities: SANDBOX_PROVIDER_PROFILES[provider].capabilities,
    limitations: describeLimitations(provider, config.mode),
  };
  if (config.mode === "direct") {
    const credential = directCredential(config);
    return {
      ...base,
      mode: "direct",
      credentialSource: credential.source,
      credentialPresent: Boolean(credential.value),
      chargedTo: `your ${PROVIDER_NAMES[provider]} account (no Gitterm account or credits used)`,
    };
  }
  return {
    ...base,
    mode: "managed",
    credentialSource: config.token ? "plugin option" : "Gitterm CLI login or GITTERM_API_TOKEN",
    credentialPresent: true,
    chargedTo: "your Gitterm plan (usage, quotas, and limits apply)",
  };
}

/** Builds exactly the selected account's backend. A missing or rejected credential is an error, never a fallback. */
export function createSandboxBackend(
  settings: SandboxSettings,
  accountName?: string,
): SandboxBackend {
  const { name, config, provider } = selected(settings, accountName);
  if (config.mode === "managed")
    return createManagedSandboxBackend({
      account: name,
      provider,
      client: createGittermClient({ serverUrl: config.serverUrl, token: config.token }),
    });
  const credential = directCredential(config);
  if (!credential.value)
    throw new Error(
      `Sandbox account ${name} has no ${PROVIDER_NAMES[provider]} credential (${credential.source}). In OpenCode use "apiKey": "{env:YOUR_VARIABLE}" and make sure the variable is set.`,
    );
  const { apiKey: _apiKey, apiKeyEnv: _apiKeyEnv, allowUnboundedLifetime, ...options } = config;
  return createDirectSandboxBackend({
    account: name,
    allowUnboundedLifetime,
    transport: createSandboxTransport({ ...options, apiKey: credential.value }),
  });
}
