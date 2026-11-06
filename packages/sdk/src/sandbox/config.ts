import { createSandboxTransport } from "@gitterm/agent-runtime/sandbox/index";
import { SANDBOX_PROVIDER_PROFILES } from "@gitterm/agent-runtime/sandbox/types";
import { createGittermClient } from "../client.js";
import {
  createDirectSandboxBackend,
  createManagedSandboxBackend,
  managedCapabilities,
  validateAccountName,
  type SandboxBackend,
  type SandboxMode,
} from "./backend.js";
import type { SandboxLimits } from "./client.js";
import {
  isSandboxProviderError,
  type SandboxCapabilities,
  type SandboxProviderKey,
} from "./types.js";

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
      /**
       * Template ID or name. E2B fixes CPU and memory when a template is built, so this is
       * also the machine size. Defaults to `base` (2 vCPU, 512 MB, no agent).
       */
      template?: string;
    } & DirectCredential)
  | ({
      mode: "direct";
      provider: "daytona";
      target?: "us" | "eu";
      /** Daytona snapshot name. A snapshot carries its own size, so it excludes `resources`. */
      snapshot?: string;
      /** vCPUs and GiB of memory and disk. Defaults to Daytona's 1 vCPU, 1 GiB, 3 GiB. */
      resources?: { cpu?: number; memory?: number; disk?: number };
    } & DirectCredential)
  | ({
      mode: "direct";
      provider: "vercel";
      teamId: string;
      projectId: string;
      runtime?: "node24" | "node22" | "python3.13";
      /** 1 to 8; Vercel gives 2 GB of memory per vCPU. Defaults to 2. */
      vcpus?: number;
    } & DirectCredential)
  | ({ mode: "direct"; provider: "boat"; size?: "small" | "default" | "large" } & DirectCredential)
  | ({
      mode: "direct";
      provider: "exedev";
      /** Container image; defaults to a plain Node image. */ image?: string;
      /** VM size, as exe.dev's `new` flags take it, e.g. `4`, `"8GB"`, `"20GB"`. */
      cpu?: number;
      memory?: string;
      disk?: string;
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
      /** Defaults to e2b, or to Gitterm when `size` is set. The deployment must enable it. */
      provider?: SandboxProviderKey;
      /**
       * On gitterm.dev: `small`, `medium`, or `large`. Same as `provider: "gitterm"` with that
       * machine.
       */
      size?: "small" | "medium" | "large";
      /** Machine profile key, e.g. `small` or `large`. Defaults to your plan's default size. */
      machine?: string;
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
  /**
   * Create every sandbox with public previews: anyone with a preview URL can open it.
   * Setting this is the approval, so nobody is asked per sandbox.
   */
  publicPreviews?: boolean;
};

export type SandboxAccountSummary = {
  name: string;
  mode: SandboxMode;
  provider: SandboxProviderKey;
  /** Where the credential comes from. Never the credential itself. */
  credentialSource: string;
  credentialPresent: boolean;
  chargedTo: string;
  /** The machine size and who sets it: the user, in the account settings, never the agent. */
  machine: string;
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
  gitterm: "Gitterm",
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
  // A managed `size` means Gitterm's own sandboxes (gitterm.dev): sizes, not providers.
  const provider: string =
    config.provider ?? (config.mode === "managed" && config.size ? "gitterm" : "e2b");
  if (config.mode === "managed" && config.size && provider !== "gitterm")
    throw new Error(
      `Sandbox account ${name}: "size" picks a Gitterm size; drop "provider" or use "machine".`,
    );
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
  const capabilities =
    mode === "managed"
      ? managedCapabilities(provider)
      : SANDBOX_PROVIDER_PROFILES[provider].capabilities;
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
    capabilities.previews === "either"
      ? mode === "managed"
        ? "Gitterm serves previews: private to your Gitterm login unless created with public previews."
        : "Previews are private unless created with public previews."
      : capabilities.previews === "private"
        ? `${name} previews are always private: they need an access header.`
        : capabilities.previews === "public"
          ? `${name} previews are always public URLs, so they need the public-sharing approval.`
          : `${name} sandboxes cannot expose ports.`,
    ...(capabilities.pause === "state-losing"
      ? [`Pausing a ${name} sandbox discards its files and processes.`]
      : []),
  ];
}

function describeMachine(config: SandboxAccountConfig): string {
  if (config.mode === "managed") {
    const machine = config.size ?? config.machine;
    return machine
      ? `Gitterm machine profile "${machine}".`
      : "Your Gitterm plan's default machine profile.";
  }
  switch (config.provider) {
    case "e2b":
      return config.template
        ? `E2B template "${config.template}" (its size is fixed when the template is built).`
        : "E2B base template: 2 vCPU, 512 MB memory.";
    case "daytona": {
      if (config.snapshot) return `Daytona snapshot "${config.snapshot}" (sized by the snapshot).`;
      const { cpu = 1, memory = 1, disk = 3 } = config.resources ?? {};
      return `${cpu} vCPU, ${memory} GiB memory, ${disk} GiB disk.`;
    }
    case "vercel": {
      const vcpus = config.vcpus ?? 2;
      return `${vcpus} vCPU, ${vcpus * 2} GB memory.`;
    }
    case "boat":
      return `Boat size "${config.size ?? "default"}".`;
    case "exedev":
      return config.cpu || config.memory || config.disk
        ? `${[config.cpu && `${config.cpu} vCPU`, config.memory && `${config.memory} memory`, config.disk && `${config.disk} disk`].filter(Boolean).join(", ")}.`
        : "exe.dev's default VM size.";
    case "railway":
      return "Railway's per-service limits for your Railway plan.";
  }
}

export function describeSandboxAccount(
  settings: SandboxSettings,
  accountName?: string,
): SandboxAccountSummary {
  const { name, config, provider } = selected(settings, accountName);
  const base = {
    name,
    provider,
    capabilities:
      config.mode === "managed"
        ? managedCapabilities(provider)
        : SANDBOX_PROVIDER_PROFILES[provider].capabilities,
    limitations: describeLimitations(provider, config.mode),
    machine: `${describeMachine(config)} Only the user can change this, in the settings of sandbox account "${name}".`,
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
      machine: config.size ?? config.machine,
    });
  const credential = directCredential(config);
  if (!credential.value)
    throw new Error(
      `Sandbox account ${name} has no ${PROVIDER_NAMES[provider]} credential (${credential.source}). In OpenCode use "apiKey": "{env:YOUR_VARIABLE}" and make sure the variable is set.`,
    );
  if (config.provider === "daytona" && config.snapshot && config.resources)
    throw new Error(
      `Sandbox account ${name}: a Daytona snapshot carries its own size, so set "snapshot" or "resources", not both.`,
    );
  const { apiKey: _apiKey, apiKeyEnv: _apiKeyEnv, allowUnboundedLifetime, ...options } = config;
  return withAuthHint(
    createDirectSandboxBackend({
      account: name,
      allowUnboundedLifetime,
      transport: createSandboxTransport({ ...options, apiKey: credential.value }),
    }),
    `This is your own ${PROVIDER_NAMES[provider]} key, not Gitterm's: check sandbox account "${name}" in your settings.`,
  );
}

/** A rejected key on a direct account is the caller's own key, so say which account to fix. */
function withAuthHint(backend: SandboxBackend, hint: string): SandboxBackend {
  return new Proxy(backend, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await value.apply(target, args);
        } catch (error) {
          if (isSandboxProviderError(error) && error.code === "auth")
            error.message = `${error.message} ${hint}`;
          throw error;
        }
      };
    },
  });
}
