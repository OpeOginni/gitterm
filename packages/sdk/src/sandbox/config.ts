import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createSandboxTransport } from "@gitterm/agent-runtime/sandbox/index";
import { SANDBOX_PROVIDER_PROFILES } from "@gitterm/agent-runtime/sandbox/types";
import { createGittermClient, type GittermClient } from "../client.js";
import { GittermError } from "../errors.js";
import {
  createDirectSandboxBackend,
  createManagedSandboxBackend,
  managedCapabilities,
  validateAccountName,
  type SandboxBackend,
  type SandboxMode,
} from "./backend.js";
import { CLI_LOGIN_PROVIDERS, cliLogin } from "./cli-login.js";
import type { SandboxLimits } from "./client.js";
import {
  isSandboxProviderError,
  type SandboxCapabilities,
  type SandboxProviderKey,
} from "./types.js";

type OwnKey = {
  /**
   * The provider key, normally as `"{env:VAR}"` or `"{file:path}"`. OpenCode substitutes these
   * before the plugin sees them; the SDK and CLI resolve them the same way.
   */
  apiKey?: string;
  /** @deprecated Use `"apiKey": "{env:VAR}"`. */
  apiKeyEnv?: string;
  /**
   * Required for providers that never delete an abandoned sandbox themselves
   * (exe.dev, Railway): a crashed caller leaves it running until you destroy it.
   */
  allowUnboundedLifetime?: boolean;
};

/** Your own provider account, e.g. `{ provider: "e2b", apiKey: "{env:E2B_API_KEY}" }`. */
export type OwnKeyAccountConfig =
  | ({
      provider: "e2b";
      /**
       * Template ID or name. E2B fixes CPU and memory when a template is built, so this is
       * also the machine size. Defaults to `base` (2 vCPU, 512 MB, no agent).
       */
      template?: string;
      /** A snapshot every sandbox starts from; it keeps the size it was saved at. */
      snapshot?: string;
    } & OwnKey)
  | ({
      provider: "daytona";
      target?: "us" | "eu";
      /** Daytona snapshot name. A snapshot carries its own size, so it excludes `resources`. */
      snapshot?: string;
      /** vCPUs and GiB of memory and disk. Defaults to Daytona's 1 vCPU, 1 GiB, 3 GiB. */
      resources?: { cpu?: number; memory?: number; disk?: number };
    } & OwnKey)
  | ({
      provider: "vercel";
      teamId: string;
      projectId: string;
      runtime?: "node24" | "node22" | "python3.13";
      /** 1 to 8; Vercel gives 2 GB of memory per vCPU. Defaults to 2. */
      vcpus?: number;
      /** A snapshot id every sandbox starts from instead of `runtime`. */
      snapshot?: string;
    } & OwnKey)
  | ({
      provider: "boat";
      size?: "small" | "default" | "large";
      /** A named snapshot every box starts from. */
      snapshot?: string;
    } & OwnKey)
  | ({
      provider: "exedev";
      /** Container image; defaults to a plain Node image. */ image?: string;
      /** VM size, as exe.dev's `new` flags take it, e.g. `4`, `"8GB"`, `"20GB"`. */
      cpu?: number;
      memory?: string;
      disk?: string;
    } & OwnKey)
  | ({
      /** @deprecated Railway sandboxes will be removed in a later release; use another provider. */
      provider: "railway";
      projectId: string;
      environmentId: string;
      apiUrl?: string;
      image?: string;
    } & OwnKey);

/** Sandboxes through a GitTerm server (gitterm.dev or self-hosted), billed to your plan there. */
export type GittermAccountConfig = {
  /** Defaults to the server's default: Gitterm's own sandboxes on gitterm.dev. */
  provider?: SandboxProviderKey;
  /** Machine size, e.g. `small` or `medium` on gitterm.dev. Defaults to your plan's default. */
  size?: string;
  /** Defaults to the CLI login's server. */
  serverUrl?: string;
  /** Defaults to the CLI login or GITTERM_API_TOKEN. */
  token?: string;
};

/** A direct provider account (key or CLI login), or a managed GitTerm account. */
export type SandboxAccountConfig = OwnKeyAccountConfig | GittermAccountConfig;

type SandboxOptions = {
  limits?: Partial<SandboxLimits>;
  /** Extra glob patterns never uploaded. Secret-like files are always excluded. */
  exclude?: string[];
  /** Largest working tree a sync uploads, in MiB before compression (default 100, at most 1024). */
  maxSourceMiB?: number;
  /**
   * Create every sandbox with public previews: anyone with a preview URL can open it.
   * Setting this is the approval, so nobody is asked per sandbox.
   */
  publicPreviews?: boolean;
  /**
   * Let the agent save a setup snapshot of a sandbox once a checkout's dependencies are
   * installed, and start that checkout's next sandboxes from it. E2B, Daytona, Vercel, and
   * Boat only. Snapshots are stored in the provider account until deleted.
   * Off by default. An account's own `snapshot` setting always wins.
   */
  snapshots?: boolean;
  /** Env files for all commands, relative to the project. Later files win; `secretEnv` overrides. */
  envFiles?: string[];
};

/**
 * One account inline (`{ provider: "e2b", apiKey }`, `{ size: "medium" }`), or several under
 * `accounts` with `account` naming the selected one.
 */
export type SandboxSettings = SandboxOptions &
  (
    | { account?: string; accounts: Record<string, SandboxAccountConfig> }
    | (SandboxAccountConfig & { accounts?: undefined })
  );

/** A selected account with its provider known. From `resolveSandboxAccount`. */
export type SandboxAccount = { name: string; provider: SandboxProviderKey } & (
  | {
      ownKey: true;
      config: OwnKeyAccountConfig;
      /** Where the key came from, when it is a provider CLI login rather than `apiKey`. */
      cliLogin?: string;
    }
  | { ownKey: false; config: GittermAccountConfig; client: GittermClient }
);

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
  /** A snapshot the user set for every sandbox of this account. */
  pinnedSnapshot: string | null;
  capabilities: SandboxCapabilities;
  /** Plain-language limits of this provider for sandboxes. */
  limitations: string[];
};

const OWN_KEY_PROVIDERS = ["e2b", "daytona", "vercel", "boat", "exedev", "railway"] as const;
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

const CLI_LOGIN_HINTS: Partial<Record<SandboxProviderKey, string>> = {
  e2b: ', or run "e2b auth login"',
  daytona: ', or run "daytona login --api-key"',
  exedev: ', or add an SSH key to exe.dev so "ssh exe.dev" works',
};

/** With no GitTerm setting, E2B, Daytona, and exe.dev accounts fall back to that CLI's login. */
const usesCliLogin = (config: SandboxAccountConfig) =>
  (CLI_LOGIN_PROVIDERS as readonly unknown[]).includes(config.provider) &&
  !["serverUrl", "token", "size"].some((key) => key in config);

const isOwnKey = (config: SandboxAccountConfig): config is OwnKeyAccountConfig =>
  "apiKey" in config || "apiKeyEnv" in config || usesCliLogin(config);

function selected(settings: SandboxSettings, accountName?: string) {
  if (!settings.accounts) {
    const {
      limits: _l,
      exclude: _e,
      maxSourceMiB: _m,
      publicPreviews: _p,
      snapshots: _s,
      envFiles: _f,
      ...config
    } = settings;
    const name = config.provider ?? "gitterm";
    if (accountName && accountName !== name)
      throw new Error(`Sandbox account ${JSON.stringify(accountName)} is not configured.`);
    return { name, config: config as SandboxAccountConfig };
  }
  const name = accountName ?? settings.account;
  if (!name) {
    const names = Object.keys(settings.accounts);
    throw new Error(
      names.length
        ? `No sandbox account selected. Choose one of: ${names.join(", ")}.`
        : "No sandbox accounts are configured. Add one to the sandbox settings.",
    );
  }
  const config = settings.accounts[validateAccountName(name)];
  if (!config) throw new Error(`Sandbox account ${JSON.stringify(name)} is not configured.`);
  return { name, config };
}

/**
 * Picks the account and finds its provider. A GitTerm account without `provider` asks the
 * server for its default, so this needs the server only then.
 */
export async function resolveSandboxAccount(
  settings: SandboxSettings,
  accountName?: string,
): Promise<SandboxAccount> {
  const { name, config } = selected(settings, accountName);
  validateAccountName(name);
  if (isOwnKey(config)) {
    if (!(OWN_KEY_PROVIDERS as readonly string[]).includes(config.provider))
      throw new Error(
        `Sandbox account ${name}: "provider" must be one of ${OWN_KEY_PROVIDERS.join(", ")} with your own key.`,
      );
    if (config.apiKey === undefined && !config.apiKeyEnv) {
      const login = await cliLogin(config.provider);
      if (login)
        return {
          name,
          provider: config.provider,
          ownKey: true,
          config: { ...config, apiKey: login.value },
          cliLogin: login.source,
        };
    }
    return { name, provider: config.provider, ownKey: true, config };
  }
  // `machine` is the old name of `size`.
  const legacy = config as GittermAccountConfig & { machine?: string };
  const gitterm: GittermAccountConfig = { ...config, size: config.size ?? legacy.machine };
  if (gitterm.provider && !Object.hasOwn(SANDBOX_PROVIDER_PROFILES, gitterm.provider))
    throw new Error(
      `Sandbox account ${name} uses provider ${JSON.stringify(gitterm.provider)}, which does not support sandboxes.`,
    );
  // Without `apiKey` an account goes through GitTerm, so a forgotten key shows up here.
  const ownKeyHint =
    gitterm.provider && gitterm.provider !== "gitterm"
      ? ` To use your own ${PROVIDER_NAMES[gitterm.provider]} account instead, add "apiKey" to sandbox account "${name}".`
      : "";
  try {
    const client = createGittermClient({ serverUrl: gitterm.serverUrl, token: gitterm.token });
    const offered = await client.sandboxes.providers();
    const provider = gitterm.provider ?? offered.default;
    if (!provider || !offered.providers.includes(provider))
      throw new Error(
        `${
          !offered.providers.length
            ? "This GitTerm server offers no sandboxes to your account."
            : provider
              ? `This GitTerm server doesn't offer ${PROVIDER_NAMES[provider]} sandboxes to your account (it offers ${offered.providers.join(", ")}).`
              : `This GitTerm server offers ${offered.providers.join(", ")} sandboxes and no default. Set "provider" on sandbox account "${name}".`
        }${ownKeyHint}`,
      );
    return { name, provider, ownKey: false, config: gitterm, client };
  } catch (error) {
    if (error instanceof GittermError && error.code === "NOT_LOGGED_IN")
      error.message = `${error.message}${ownKeyHint}`;
    throw error;
  }
}

/** `{env:VAR}` or `{file:path}`, the reference syntax of OpenCode config. */
export const CREDENTIAL_REFERENCE = /^\{(env|file):([^}]+)\}$/;

/**
 * Where the gitterm CLI keeps sandbox settings, shared with Pi's extension, the skills and the
 * OpenCode plugin when its own `sandbox` option is not set.
 */
export function sandboxSettingsPath(): string {
  return (
    process.env.GITTERM_SANDBOX_CONFIG ??
    path.join(process.env.HOME || homedir(), ".config", "gitterm", "sandbox.json")
  );
}

/**
 * The sandbox settings: from `GITTERM_SANDBOX_SETTINGS` (JSON, which an agent's own settings
 * pass to the CLI, as Pi's extension does), else the settings file, else undefined. Keys must be
 * `{env:VAR}` or `{file:path}` references: a literal key or `token` is refused.
 */
export function loadSandboxSettingsFile(): SandboxSettings | undefined {
  const inline = process.env.GITTERM_SANDBOX_SETTINGS?.trim();
  if (inline)
    return checkCredentials(JSON.parse(inline) as SandboxSettings, "GITTERM_SANDBOX_SETTINGS");
  const file = sandboxSettingsPath();
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return checkCredentials(JSON.parse(text) as SandboxSettings, file);
}

function checkCredentials(settings: SandboxSettings, where: string): SandboxSettings {
  const accounts = settings.accounts ?? { [settings.provider ?? "gitterm"]: settings };
  for (const [name, account] of Object.entries(accounts)) {
    const key = "apiKey" in account ? account.apiKey : undefined;
    if ((key !== undefined && !CREDENTIAL_REFERENCE.test(key.trim())) || "token" in account)
      throw new Error(
        `Sandbox account ${name} in ${where} contains a credential. Store it in an environment variable or a file and use "apiKey": "{env:VAR}" or "{file:path}", or run \`gitterm sandbox setup\`.`,
      );
  }
  return settings;
}

function directCredential(config: OwnKey) {
  const [, kind, name = ""] = CREDENTIAL_REFERENCE.exec(config.apiKey?.trim() ?? "") ?? [];
  if (kind === "env")
    return { source: `environment variable ${name}`, value: process.env[name]?.trim() ?? "" };
  if (kind === "file") {
    let value = "";
    try {
      value = readFileSync(name.replace(/^~(?=\/)/, homedir()), "utf8").trim();
    } catch {
      // A missing file is reported like an empty key.
    }
    return { source: `file ${name}`, value };
  }
  if (config.apiKey !== undefined) return { source: "apiKey setting", value: config.apiKey.trim() };
  if (config.apiKeyEnv)
    return {
      source: `environment variable ${config.apiKeyEnv}`,
      value: process.env[config.apiKeyEnv]?.trim() ?? "",
    };
  return { source: "no apiKey and no CLI login", value: "" };
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

function describeMachine(account: SandboxAccount): string {
  if (!account.ownKey)
    return account.config.size
      ? `Gitterm machine profile "${account.config.size}".`
      : "Your Gitterm plan's default machine profile.";
  const { config } = account;
  switch (config.provider) {
    case "e2b":
      if (config.snapshot) return `E2B snapshot "${config.snapshot}" (sized as when it was saved).`;
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
      return `${vcpus} vCPU, ${vcpus * 2} GB memory${config.snapshot ? `, from snapshot "${config.snapshot}"` : ""}.`;
    }
    case "boat":
      return `Boat size "${config.size ?? "default"}"${config.snapshot ? `, from snapshot "${config.snapshot}"` : ""}.`;
    case "exedev":
      return config.cpu || config.memory || config.disk
        ? `${[config.cpu && `${config.cpu} vCPU`, config.memory && `${config.memory} memory`, config.disk && `${config.disk} disk`].filter(Boolean).join(", ")}.`
        : "exe.dev's default VM size.";
    case "railway":
      return "Railway's per-service limits for your Railway plan.";
  }
}

export function describeSandboxAccount(account: SandboxAccount): SandboxAccountSummary {
  const { name, provider } = account;
  const mode: SandboxMode = account.ownKey ? "direct" : "managed";
  const base = {
    name,
    mode,
    provider,
    capabilities: account.ownKey
      ? SANDBOX_PROVIDER_PROFILES[provider].capabilities
      : managedCapabilities(provider),
    limitations: describeLimitations(provider, mode),
    pinnedSnapshot:
      account.ownKey && "snapshot" in account.config ? (account.config.snapshot ?? null) : null,
    machine: `${describeMachine(account)} Only the user can change this, in the settings of sandbox account "${name}".`,
  };
  if (account.ownKey) {
    const credential = directCredential(account.config);
    return {
      ...base,
      credentialSource: account.cliLogin ?? credential.source,
      credentialPresent: Boolean(credential.value),
      chargedTo: `your ${PROVIDER_NAMES[provider]} account (no Gitterm account or credits used)`,
    };
  }
  return {
    ...base,
    credentialSource: account.config.token
      ? "plugin option"
      : "Gitterm CLI login or GITTERM_API_TOKEN",
    credentialPresent: true,
    chargedTo: "your Gitterm plan (usage, quotas, and limits apply)",
  };
}

/** Builds exactly this account's backend. A missing or rejected credential is an error, never a fallback. */
export function createSandboxBackend(account: SandboxAccount): SandboxBackend {
  const { name, provider } = account;
  if (!account.ownKey)
    return createManagedSandboxBackend({
      account: name,
      provider,
      client: account.client,
      machine: account.config.size,
    });
  const { config } = account;
  const credential = directCredential(config);
  // OpenCode substitutes an unset `{env:VAR}` with "".
  if (config.apiKey === "")
    throw new Error(
      `Sandbox account ${name}: "apiKey" is empty. If it is "{env:VAR}", VAR isn't set for OpenCode's background service, which doesn't see your terminal's variables. Run "opencode service set env VAR value" and "opencode service restart", or use "{file:path}".`,
    );
  if (!credential.value)
    throw new Error(
      `Sandbox account ${name} has no ${PROVIDER_NAMES[provider]} credential (${credential.source}). Use "apiKey": "{env:YOUR_VARIABLE}" and make sure the variable is set${CLI_LOGIN_HINTS[provider] ?? ""}.`,
    );
  if (config.provider === "daytona" && config.snapshot && config.resources)
    throw new Error(
      `Sandbox account ${name}: a Daytona snapshot carries its own size, so set "snapshot" or "resources", not both.`,
    );
  const { apiKey: _apiKey, apiKeyEnv: _apiKeyEnv, allowUnboundedLifetime, ...options } = config;
  // `mode` from configs written before it went away.
  delete (options as { mode?: unknown }).mode;
  return withHint(
    createDirectSandboxBackend({
      account: name,
      allowUnboundedLifetime,
      transport: createSandboxTransport({ ...options, apiKey: credential.value }),
    }),
    (error) => isSandboxProviderError(error) && error.code === "auth",
    `This is your own ${PROVIDER_NAMES[provider]} key, not Gitterm's: check sandbox account "${name}" in your settings.`,
  );
}

/** Adds what the user can do about an error to its message, e.g. which account to fix. */
function withHint(
  backend: SandboxBackend,
  matches: (error: unknown) => boolean,
  hint: string,
): SandboxBackend {
  return new Proxy(backend, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await value.apply(target, args);
        } catch (error) {
          if (matches(error)) (error as Error).message = `${(error as Error).message} ${hint}`;
          throw error;
        }
      };
    },
  });
}
