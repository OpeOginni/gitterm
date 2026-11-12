import {
  accountHash,
  GITTERM_PREVIEW_PROVIDERS,
  SANDBOX_PROVIDER_PROFILES,
  SandboxProviderError,
  type SandboxProviderInfo,
  type SandboxTransport,
} from "@gitterm/agent-runtime/sandbox/types";
import type { GittermClient } from "../client.js";
import { GittermError } from "../errors.js";
import type { ManagedSandbox } from "../types.js";
import type {
  SandboxCapabilities,
  SandboxCommandResult,
  SandboxPreviewAccess,
  SandboxProviderKey,
} from "./types.js";

/** `managed`: billed to a Gitterm account. `direct`: your own provider account and credentials. */
export type SandboxMode = "managed" | "direct";
export type SandboxProvider = SandboxProviderKey;

/** Who owns and pays for a sandbox. Part of every reference; never inferred. */
export type SandboxIdentity = { mode: SandboxMode; provider: SandboxProvider; account: string };
export type SandboxRef = SandboxIdentity & { id: string };
/** `deleting`: terminated in Gitterm, provider deletion not yet confirmed (managed only). */
export type SandboxState = "pending" | "running" | "paused" | "deleting" | "terminated";

export type SandboxInfo = SandboxRef & {
  state: SandboxState;
  name: string | null;
  createdAt: string | null;
  /** When the sandbox is deleted regardless of activity, if anything enforces that. */
  expiresAt: string | null;
  labels: Record<string, string>;
};

export type SandboxCreateRequest = {
  name: string;
  lifetimeMs: number;
  labels: Record<string, string>;
  publicPreviews: boolean;
  /** Start from this snapshot instead of the account's image. */
  snapshot?: string;
};

/** Provider snapshots of a sandbox's disk. Stored in, and billed to, the provider account. */
export type SandboxSnapshotSupport = {
  /** What saving does to the sandbox: `pauses` it briefly, or `stops` it for good (Vercel). */
  effect: "pauses" | "stops";
  /** Returns the id new sandboxes start from. */
  create(id: string, name: string): Promise<string>;
  delete(snapshotId: string): Promise<void>;
};

/** The primitives a provider account offers. Jobs, sync, and artifacts are built on these. */
export interface SandboxBackend {
  readonly identity: SandboxIdentity;
  /** Home directory of the command user in the sandbox. */
  readonly home: string;
  readonly capabilities: SandboxCapabilities;
  create(input: SandboxCreateRequest): Promise<SandboxInfo>;
  /** Returns `terminated` for a sandbox that no longer exists in this account. */
  get(id: string): Promise<SandboxInfo>;
  list(): Promise<SandboxInfo[]>;
  destroy(id: string): Promise<void>;
  /** Managed sandboxes also pause when idle; direct ones only on request. */
  pause?(id: string): Promise<void>;
  resume?(id: string): Promise<void>;
  run(
    id: string,
    command: string,
    options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ): Promise<SandboxCommandResult>;
  writeFile(id: string, path: string, data: Uint8Array): Promise<void>;
  readFile(id: string, path: string): Promise<Uint8Array>;
  /**
   * `gittermUrl` is set when Gitterm serves the preview: open to anyone if `public`, else
   * only to the owner signed in to Gitterm. `url` and `headers` reach the provider directly.
   */
  preview(
    id: string,
    port: number,
    options?: { public?: boolean },
  ): Promise<SandboxPreviewAccess & { gittermUrl?: string }>;
  /**
   * Pushes job completions as they happen, where the backend can (Gitterm sandboxes on
   * gitterm.dev). Without it, callers learn a job finished by reading it. Returns a stop function.
   */
  onJobFinished?(listener: (event: { sandboxId: string; jobId: string }) => void): () => void;
  /** Present on direct accounts whose provider can snapshot a sandbox. */
  snapshots?: SandboxSnapshotSupport;
}

/** What a managed account offers: Gitterm serves previews of some providers itself. */
export function managedCapabilities(provider: SandboxProvider): SandboxCapabilities {
  const { capabilities } = SANDBOX_PROVIDER_PROFILES[provider];
  return GITTERM_PREVIEW_PROVIDERS.includes(provider)
    ? { ...capabilities, previews: "either" }
    : capabilities;
}

export class SandboxAccountError extends GittermError {
  constructor(message: string) {
    super("FORBIDDEN", message);
    this.name = "SandboxAccountError";
  }
}

const ACCOUNT_LABEL = "gitterm_account";
const WORKLOAD_LABEL = "gitterm_workload";
const NAME_LABEL = "gitterm_name";

export function validateAccountName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(name))
    throw new Error(`Invalid sandbox account name: ${JSON.stringify(name)}`);
  return name;
}

/**
 * A provider account you own. Its credential stays in this process and goes only to the
 * provider. No Gitterm login, server, or credits are involved. Use `createSandboxBackend`.
 * @internal
 */
export function createDirectSandboxBackend(options: {
  account: string;
  transport: SandboxTransport;
  /** Required for providers that never delete an abandoned sandbox on their own. */
  allowUnboundedLifetime?: boolean;
}): SandboxBackend {
  const account = validateAccountName(options.account);
  const { transport } = options;
  const identity: SandboxIdentity = { mode: "direct", provider: transport.provider, account };

  const toInfo = (info: SandboxProviderInfo): SandboxInfo => ({
    ...identity,
    id: info.id,
    state: info.state,
    name: info.labels[NAME_LABEL] ?? null,
    createdAt: info.startedAt,
    expiresAt: info.expiresAt,
    labels: info.labels,
  });

  /** One provider credential may back several named accounts; labels keep their sandboxes apart. */
  const owned = async (id: string) => {
    const info = await transport.info(id);
    // Providers without labels report a hash of the account encoded in the sandbox name.
    const ownedByAccount =
      info.labels[ACCOUNT_LABEL] === account ||
      info.labels.gitterm_account_hash === accountHash(account);
    if (info.state !== "terminated" && !ownedByAccount)
      throw new SandboxAccountError(
        `Sandbox ${id} was not created by direct account ${JSON.stringify(account)}. Select the account that created it.`,
      );
    return info;
  };
  const running = async (id: string) => {
    const info = await owned(id);
    if (info.state === "terminated")
      throw new SandboxProviderError("not_found", `Sandbox ${id} no longer exists.`);
  };
  const ended = (info: SandboxProviderInfo) =>
    !!info.expiresAt && Date.parse(info.expiresAt) <= Date.now();
  /**
   * Where the provider deletes at the lifetime, a paused sandbox can escape it (E2B keeps
   * paused sandboxes), so one seen paused past its lifetime is deleted here.
   */
  const expire = async (info: SandboxProviderInfo): Promise<SandboxProviderInfo> => {
    if (info.state !== "paused" || transport.capabilities.expiry !== "hard" || !ended(info))
      return info;
    await transport.destroy(info.id);
    return { ...info, state: "terminated" };
  };

  return {
    identity,
    home: transport.home,
    capabilities: transport.capabilities,
    async create(input) {
      if (transport.capabilities.expiry === "none" && !options.allowUnboundedLifetime)
        throw new Error(
          `${transport.provider} never deletes an abandoned sandbox, so a crashed caller would leave it running and billing. Set "allowUnboundedLifetime": true on account ${account} to accept that and clean up with destroy, or use a managed account (the Gitterm worker enforces lifetimes).`,
        );
      return toInfo(
        await transport.create({
          labels: {
            ...input.labels,
            [ACCOUNT_LABEL]: account,
            [WORKLOAD_LABEL]: "sandbox",
            [NAME_LABEL]: input.name.slice(0, 120),
          },
          timeoutMs: input.lifetimeMs,
          onTimeout: "kill",
          publicPreviews: input.publicPreviews,
          ...(input.snapshot ? { snapshot: input.snapshot } : {}),
        }),
      );
    },
    async get(id) {
      return toInfo(await expire(await owned(id)));
    },
    async list() {
      const items = await transport.list({ [ACCOUNT_LABEL]: account, [WORKLOAD_LABEL]: "sandbox" });
      return Promise.all(items.map(async (info) => toInfo(await expire(info))));
    },
    async destroy(id) {
      await owned(id);
      await transport.destroy(id);
    },
    // Direct Vercel sandboxes are not persistent, so stopping one discards it.
    ...(transport.provider === "vercel"
      ? {}
      : {
          async pause(id) {
            await running(id);
            await transport.pause(id);
          },
          async resume(id) {
            const info = await owned(id);
            if (info.state === "terminated" || ended(info))
              throw new SandboxProviderError(
                "not_found",
                `Sandbox ${id} has reached its lifetime limit.`,
              );
            await transport.resume(id);
          },
        }),
    async run(id, command, runOptions) {
      await running(id);
      return transport.run(id, command, runOptions);
    },
    async writeFile(id, path, data) {
      await running(id);
      return transport.writeFile(id, path, data);
    },
    async readFile(id, path) {
      await running(id);
      return transport.readFile(id, path);
    },
    async preview(id, port) {
      await running(id);
      return transport.preview(id, port);
    },
    ...(transport.snapshots
      ? {
          snapshots: {
            effect: transport.capabilities.snapshots as "pauses" | "stops",
            async create(id, name) {
              await running(id);
              return transport.snapshots!.create(id, name);
            },
            delete: (snapshotId) => transport.snapshots!.delete(snapshotId),
          } satisfies SandboxSnapshotSupport,
        }
      : {}),
  };
}

const MANAGED_CHUNK_BYTES = 6 * 1024 * 1024;

/**
 * Sandboxes billed to your Gitterm account. The provider credential stays on the Gitterm
 * server; this process holds only your Gitterm API token.
 */
export function createManagedSandboxBackend(options: {
  account: string;
  provider: SandboxProvider;
  client: GittermClient;
  /** Machine profile key; the server checks it against the plan. */
  machine?: string;
}): SandboxBackend {
  const account = validateAccountName(options.account);
  const { client, provider } = options;
  const identity: SandboxIdentity = { mode: "managed", provider, account };
  const toInfo = (sandbox: ManagedSandbox): SandboxInfo => {
    if (sandbox.provider !== provider)
      throw new SandboxAccountError(
        `Sandbox ${sandbox.id} runs on ${sandbox.provider}, but managed account ${JSON.stringify(account)} is configured for ${provider}.`,
      );
    return {
      ...identity,
      id: sandbox.id,
      state: sandbox.status === "terminated" && !sandbox.deleted ? "deleting" : sandbox.status,
      name: sandbox.name,
      createdAt: sandbox.createdAt,
      expiresAt: sandbox.expiresAt,
      labels: sandbox.metadata,
    };
  };

  return {
    identity,
    home: SANDBOX_PROVIDER_PROFILES[provider].home,
    capabilities: managedCapabilities(provider),
    async create(input) {
      return toInfo(
        await client.sandboxes.create({
          provider,
          name: input.name.slice(0, 120),
          machine: options.machine,
          lifetimeMinutes: Math.ceil(input.lifetimeMs / 60_000),
          publicPreviews: input.publicPreviews,
          metadata: input.labels,
          ...(input.snapshot ? { snapshotId: input.snapshot } : {}),
        }),
      );
    },
    async get(id) {
      try {
        return toInfo(await client.sandboxes.get(id));
      } catch (error) {
        if (error instanceof GittermError && error.code === "NOT_FOUND")
          return {
            ...identity,
            id,
            state: "terminated",
            name: null,
            createdAt: null,
            expiresAt: null,
            labels: {},
          };
        throw error;
      }
    },
    async list() {
      return (await client.sandboxes.list())
        .filter((sandbox) => sandbox.provider === provider)
        .map(toInfo);
    },
    destroy: (id) => client.sandboxes.terminate(id),
    pause: (id) => client.sandboxes.pause(id),
    resume: (id) => client.sandboxes.resume(id),
    // Only Gitterm's own sandboxes report finished jobs.
    ...(provider === "gitterm"
      ? { onJobFinished: (listener) => client.sandboxes.onJobFinished(listener) }
      : {}),
    run: (id, command, runOptions) => client.sandboxes.run(id, command, runOptions),
    async writeFile(id, path, data) {
      if (data.byteLength <= MANAGED_CHUNK_BYTES) return client.sandboxes.writeFile(id, path, data);
      // Large uploads travel in chunks and are joined in the sandbox.
      const parts: string[] = [];
      for (let offset = 0; offset < data.byteLength; offset += MANAGED_CHUNK_BYTES) {
        const part = `${path}.part${parts.length}`;
        await client.sandboxes.writeFile(
          id,
          part,
          data.subarray(offset, offset + MANAGED_CHUNK_BYTES),
        );
        parts.push(part);
      }
      const quoted = parts.map((part) => `'${part.replaceAll("'", `'"'"'`)}'`).join(" ");
      const target = `'${path.replaceAll("'", `'"'"'`)}'`;
      const joined = await client.sandboxes.run(id, `cat ${quoted} > ${target} && rm -f ${quoted}`);
      if (joined.exitCode !== 0)
        throw new Error("Could not assemble the uploaded file in the sandbox");
    },
    readFile: (id, path) => client.sandboxes.readFile(id, path),
    preview: (id, port, previewOptions) => client.sandboxes.preview(id, port, previewOptions),
    // Saved in the deployment's provider account and counted against your plan's limit.
    ...(SANDBOX_PROVIDER_PROFILES[provider].capabilities.snapshots !== "none"
      ? {
          snapshots: {
            effect: SANDBOX_PROVIDER_PROFILES[provider].capabilities.snapshots as
              | "pauses"
              | "stops",
            create: async (id, name) => (await client.sandboxes.saveSnapshot(id, name)).id,
            delete: (snapshotId) => client.sandboxes.deleteSnapshot(snapshotId),
          } satisfies SandboxSnapshotSupport,
        }
      : {}),
  };
}
