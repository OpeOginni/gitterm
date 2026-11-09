import {
  accountHash,
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
  /** Managed sandboxes pause when idle; direct sandboxes are deleted at their deadline instead. */
  resume?(id: string): Promise<void>;
  run(
    id: string,
    command: string,
    options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ): Promise<SandboxCommandResult>;
  writeFile(id: string, path: string, data: Uint8Array): Promise<void>;
  readFile(id: string, path: string): Promise<Uint8Array>;
  preview(id: string, port: number): Promise<SandboxPreviewAccess>;
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
        }),
      );
    },
    async get(id) {
      return toInfo(await owned(id));
    },
    async list() {
      return (await transport.list({ [ACCOUNT_LABEL]: account, [WORKLOAD_LABEL]: "sandbox" })).map(
        toInfo,
      );
    },
    async destroy(id) {
      await owned(id);
      await transport.destroy(id);
    },
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
    ...SANDBOX_PROVIDER_PROFILES[provider],
    async create(input) {
      return toInfo(
        await client.sandboxes.create({
          provider,
          name: input.name.slice(0, 120),
          lifetimeMinutes: Math.ceil(input.lifetimeMs / 60_000),
          publicPreviews: input.publicPreviews,
          metadata: input.labels,
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
    resume: (id) => client.sandboxes.resume(id),
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
    preview: (id, port) => client.sandboxes.preview(id, port),
  };
}
