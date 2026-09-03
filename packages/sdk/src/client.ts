import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "@gitterm/api/routers/index";
import { DEFAULT_GITTERM_SERVER_URL, loadConfigSync } from "./config.js";
import {
  GittermError,
  WORKSPACE_LIFECYCLE_ERROR_CODES,
  WorkspaceLifecycleError,
  type CredentialErrorCode,
  type GittermErrorCode,
} from "./errors.js";
import type {
  AgentType,
  AgentRun,
  AgentRunCreateInput,
  AgentRunListOptions,
  AgentRunListResult,
  AgentRunMessage,
  AuthStatus,
  CloudProvider,
  RunRef,
  WaitOptions,
  Workspace,
  WorkspaceCreateInput,
  WorkspaceCreateResult,
  WorkspaceEnsureRunningResult,
  WorkspaceListOptions,
  WorkspaceListResult,
  WorkspaceRef,
  WorkspaceRestartResult,
  WorkspaceRuntimeAccess,
  WorkspacePauseResult,
  WorkspaceTerminateResult,
  WorkspaceCatalog,
  WorkspaceSetupStatus,
  ModelCredential,
  ModelProviderInfo,
} from "./types.js";
import { createNoRedirectFetch, normalizeServerUrl } from "./transport.js";

export type GittermClientOptions = {
  serverUrl?: string;
  token?: string;
  configPath?: string;
  fetch?: typeof fetch;
};

type Credentials = {
  serverUrl: string;
  token: string;
};

type HttpBatchLinkOptions = Parameters<typeof httpBatchLink>[0];

type RawWorkspace = {
  id: string;
  name: string | null;
  status: Workspace["status"];
  repositoryUrl: string | null;
  repositoryBranch: string | null;
  repositoryBaseCommit?: string | null;
  repositoryCheckoutRef?: string | null;
  baseCommit?: string | null;
  checkoutRef?: string | null;
  domain: string;
  subdomain: string | null;
  persistent: boolean;
  hostingType: Workspace["hostingType"];
  serverOnly: boolean;
  workspaceProfile: string;
  cloudProviderId: string;
  image?: {
    id: string;
    name: string;
    imageId: string;
    agentType?: { id: string; name: string; description: string | null } | null;
  } | null;
  metadata?: Record<string, string> | null;
  autoTerminateAt?: Date | string | null;
  customImage?: string | null;
  startedAt: Date | string | null;
  pausedAt: Date | string | null;
  terminatedAt: Date | string | null;
  lastActiveAt: Date | string | null;
  updatedAt: Date | string | null;
};

type RawRuntimeAccess = {
  workspaceId: string;
  status: Workspace["status"];
  url: string | null;
  headers?: Record<string, string>;
  password?: string;
  directory: string;
  repo: string | null;
  branch: string | null;
  baseCommit: string | null;
  checkoutRef: string | null;
  persistent: boolean;
  recoverable: boolean;
  providerKey: string | null;
};

export type GittermClient = {
  serverUrl: string;
  auth: { status(): Promise<AuthStatus> };
  workspaces: {
    list(input?: WorkspaceListOptions): Promise<WorkspaceListResult>;
    get(workspace: WorkspaceRef): Promise<Workspace>;
    getRuntimeAccess(workspace: WorkspaceRef): Promise<WorkspaceRuntimeAccess>;
    /** Resume a paused workspace if needed and wait until it is running. */
    ensureRunning(
      workspace: WorkspaceRef,
      options?: WaitOptions,
    ): Promise<WorkspaceEnsureRunningResult>;
    pause(workspace: WorkspaceRef): Promise<WorkspacePauseResult>;
    restart(workspace: WorkspaceRef): Promise<WorkspaceRestartResult>;
    terminate(workspace: WorkspaceRef): Promise<WorkspaceTerminateResult>;
    create(input: WorkspaceCreateInput): Promise<WorkspaceCreateResult>;
    setupStatus(workspace: WorkspaceRef): Promise<WorkspaceSetupStatus>;
    waitForSetup(workspace: WorkspaceRef, options?: WaitOptions): Promise<WorkspaceSetupStatus>;
  };
  runs: {
    create(input: AgentRunCreateInput): Promise<AgentRun>;
    list(workspace: WorkspaceRef, options?: AgentRunListOptions): Promise<AgentRunListResult>;
    get(run: RunRef): Promise<AgentRun>;
    get(workspaceId: string, runId: string): Promise<AgentRun>;
    messages(run: RunRef): Promise<AgentRunMessage[]>;
    messages(workspaceId: string, runId: string): Promise<AgentRunMessage[]>;
    cancel(run: RunRef): Promise<{ cancelled: boolean }>;
    cancel(workspaceId: string, runId: string): Promise<{ cancelled: boolean }>;
    wait(run: RunRef, options?: WaitOptions): Promise<AgentRun>;
    wait(workspaceId: string, runId: string, options?: WaitOptions): Promise<AgentRun>;
  };
  catalog: {
    agentTypes(input?: { serverOnly?: boolean }): Promise<AgentType[]>;
    cloudProviders(input?: {
      localOnly?: boolean;
      cloudOnly?: boolean;
      sandboxOnly?: boolean;
      nonSandboxOnly?: boolean;
    }): Promise<CloudProvider[]>;
    workspaceOptions(): Promise<WorkspaceCatalog>;
  };
  credentials: {
    list(): Promise<ModelCredential[]>;
    listProviders(): Promise<ModelProviderInfo[]>;
  };
};

function envValue(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env[name] : undefined;
  return value && value.trim() ? value : undefined;
}

function resolveCredentials(options: GittermClientOptions): Credentials {
  const config = !options.serverUrl || !options.token ? loadConfigSync(options.configPath) : null;
  const serverUrl =
    options.serverUrl ??
    envValue("GITTERM_SERVER_URL") ??
    config?.serverUrl ??
    DEFAULT_GITTERM_SERVER_URL;
  const token = options.token ?? envValue("GITTERM_API_TOKEN") ?? config?.token;

  if (!serverUrl || !token) {
    throw new GittermError("NOT_LOGGED_IN", "Not logged in. Run: gitterm login");
  }

  return { serverUrl: normalizeServerUrl(serverUrl), token };
}

function toTrpcUrl(serverUrl: string): string {
  return new URL("/trpc", serverUrl).toString();
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeBaseCommit(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function workspaceIdOf(ref: WorkspaceRef): string {
  return typeof ref === "string" ? ref : ref.id;
}

function runTargetOf(refOrWorkspaceId: RunRef | string, runId?: string) {
  if (typeof refOrWorkspaceId === "string") {
    if (!runId) throw new GittermError("BAD_REQUEST", "runId is required");
    return { workspaceId: refOrWorkspaceId, runId };
  }
  return {
    workspaceId: refOrWorkspaceId.workspaceId,
    runId: "runId" in refOrWorkspaceId ? refOrWorkspaceId.runId : refOrWorkspaceId.id,
  };
}

function throwIfAborted(signal: AbortSignal | undefined, what: string): void {
  if (signal?.aborted) throw new GittermError("ABORTED", `Aborted while ${what}`);
}

/** Sleep that wakes early (and rejects with ABORTED) when the signal fires. */
function sleep(ms: number, signal: AbortSignal | undefined, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GittermError("ABORTED", `Aborted while ${what}`));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeWorkspace(workspace: RawWorkspace | null | undefined): Workspace | null {
  if (!workspace) return null;
  return {
    id: workspace.id,
    name: workspace.name,
    status: workspace.status,
    repositoryUrl: workspace.repositoryUrl,
    repositoryBranch: workspace.repositoryBranch,
    baseCommit: normalizeBaseCommit(workspace.baseCommit ?? workspace.repositoryBaseCommit ?? null),
    checkoutRef: workspace.checkoutRef ?? workspace.repositoryCheckoutRef ?? null,
    domain: workspace.domain,
    subdomain: workspace.subdomain,
    persistent: workspace.persistent,
    hostingType: workspace.hostingType,
    serverOnly: workspace.serverOnly,
    workspaceProfile: workspace.workspaceProfile,
    cloudProviderId: workspace.cloudProviderId,
    agentType: workspace.image?.agentType
      ? {
          id: workspace.image.agentType.id,
          name: workspace.image.agentType.name,
          description: workspace.image.agentType.description,
        }
      : null,
    image: workspace.image
      ? {
          id: workspace.image.id,
          name: workspace.image.name,
          imageId: workspace.image.imageId,
        }
      : null,
    metadata: workspace.metadata ?? {},
    autoTerminateAt: toIso(workspace.autoTerminateAt),
    customImage: workspace.customImage ?? null,
    startedAt: toIso(workspace.startedAt),
    pausedAt: toIso(workspace.pausedAt),
    terminatedAt: toIso(workspace.terminatedAt),
    lastActiveAt: toIso(workspace.lastActiveAt),
    updatedAt: toIso(workspace.updatedAt),
  };
}

function normalizeRuntime(runtime: RawRuntimeAccess): WorkspaceRuntimeAccess {
  return {
    workspaceId: runtime.workspaceId,
    status: runtime.status,
    url: runtime.url,
    headers: runtime.headers,
    password: runtime.password,
    directory: runtime.directory,
    repo: runtime.repo,
    branch: runtime.branch,
    baseCommit: normalizeBaseCommit(runtime.baseCommit),
    checkoutRef: runtime.checkoutRef,
    persistent: runtime.persistent,
    recoverable: runtime.recoverable,
    providerKey: runtime.providerKey,
  };
}

function mapTrpcCode(code: string | undefined): GittermErrorCode {
  switch (code) {
    case "UNAUTHORIZED":
      return "UNAUTHORIZED";
    case "NOT_FOUND":
      return "NOT_FOUND";
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "BAD_REQUEST":
      return "BAD_REQUEST";
    case "CONFLICT":
      return "CONFLICT";
    default:
      return "SERVER_ERROR";
  }
}

function credentialErrorCode(message: string): CredentialErrorCode | undefined {
  const match = /^(MODEL_CREDENTIAL_(?:UNAVAILABLE|DUPLICATE_PROVIDER|INVALID|REQUIRED)):\s*/.exec(
    message,
  );
  return match?.[1] as CredentialErrorCode | undefined;
}

async function runWithServer<T>(serverUrl: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof GittermError) throw error;

    if (error instanceof TRPCClientError) {
      const trpcCode = (error.data as { code?: string } | undefined)?.code;
      // No error envelope means the request never produced a tRPC response
      // (connection refused, DNS failure, non-tRPC proxy error, ...).
      if (!error.data) {
        throw new GittermError("NETWORK", `Could not reach the GitTerm server at ${serverUrl}`, {
          cause: error,
        });
      }
      const code = mapTrpcCode(trpcCode);
      const credentialCode = credentialErrorCode(error.message);
      if (credentialCode) throw new GittermError(credentialCode, error.message, { cause: error });
      const lifecycleCode = WORKSPACE_LIFECYCLE_ERROR_CODES.find((candidate) =>
        error.message.includes(candidate),
      );
      if (lifecycleCode) {
        throw new WorkspaceLifecycleError(lifecycleCode, error.message, { cause: error });
      }
      throw new GittermError(
        code,
        code === "UNAUTHORIZED"
          ? `Authentication failed: ${error.message}. Check that the API token is valid and has not expired.`
          : error.message,
        { cause: error },
      );
    }

    throw new GittermError(
      "NETWORK",
      error instanceof Error ? error.message : "Network request failed",
      { cause: error },
    );
  }
}

export function createGittermClient(options: GittermClientOptions = {}): GittermClient {
  const credentials = resolveCredentials(options);
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: toTrpcUrl(credentials.serverUrl),
        fetch: createNoRedirectFetch(options.fetch) as HttpBatchLinkOptions["fetch"],
        headers: () => ({ authorization: `Bearer ${credentials.token}` }),
      }),
    ],
  });

  const run = <T>(operation: () => Promise<T>) => runWithServer(credentials.serverUrl, operation);

  const normalizeCreateResult = (result: {
    workspace: RawWorkspace;
    runtime?: RawRuntimeAccess | null;
  }): WorkspaceCreateResult => {
    const workspace = normalizeWorkspace(result.workspace);
    if (!workspace) throw new GittermError("SERVER_ERROR", "Workspace creation failed");
    const runtime = result.runtime
      ? normalizeRuntime(result.runtime)
      : {
          workspaceId: workspace.id,
          status: workspace.status,
          url: null,
          directory: "/workspace",
          repo: workspace.repositoryUrl,
          branch: workspace.repositoryBranch,
          baseCommit: workspace.baseCommit,
          checkoutRef: workspace.checkoutRef,
          persistent: workspace.persistent,
          recoverable: workspace.status !== "terminated",
          providerKey: null,
        };
    return { workspace, runtime };
  };

  const createWorkspace = (input: WorkspaceCreateInput) =>
    run(async (): Promise<WorkspaceCreateResult> => {
      const result = await trpc.workspace.createWorkspace.mutate(input);
      return normalizeCreateResult(
        result as { workspace: RawWorkspace; runtime?: RawRuntimeAccess },
      );
    });

  const waitForWorkspaceSetup = async (
    workspaceId: string,
    waitOptions?: WaitOptions,
  ): Promise<WorkspaceSetupStatus> => {
    const timeoutMs = waitOptions?.timeoutMs ?? 10 * 60_000;
    const pollIntervalMs = waitOptions?.pollIntervalMs ?? 2_000;
    const signal = waitOptions?.signal;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      throwIfAborted(signal, "waiting for workspace setup");
      const result = await trpc.workspace.getSetupStatus.query({ workspaceId }, { signal });
      if (result.status === "not_requested" || result.status === "succeeded") return result;
      if (result.status === "failed") {
        const log = result.log?.trim();
        throw new GittermError(
          "BAD_REQUEST",
          `Workspace setup failed${result.exitCode === null ? "" : ` with exit code ${result.exitCode}`}${log ? `\n${log}` : ""}`,
        );
      }
      if (Date.now() >= deadline) {
        const log = result.log?.trim();
        throw new GittermError(
          "NETWORK",
          `Timed out waiting for workspace ${workspaceId} setup (last status: ${result.status})${log ? `\n${log}` : ""}`,
        );
      }
      await sleep(pollIntervalMs, signal, "waiting for workspace setup");
    }
  };

  return {
    serverUrl: credentials.serverUrl,
    auth: {
      status: () =>
        run(async (): Promise<AuthStatus> => {
          const me = await trpc.agent.me.query();
          return {
            loggedIn: true,
            userId: me.userId,
            email: me.email,
            name: me.name,
            plan: me.plan ?? "free",
            authMethod: me.authMethod as AuthStatus["authMethod"],
          };
        }),
    },
    workspaces: {
      list: (input?: WorkspaceListOptions) =>
        run(async (): Promise<WorkspaceListResult> => {
          const result = await trpc.workspace.listWorkspaces.query(input);
          return {
            workspaces: (result.workspaces as RawWorkspace[])
              .map(normalizeWorkspace)
              .filter((workspace): workspace is Workspace => workspace !== null),
            pagination: result.pagination,
          };
        }),
      get: (ref: WorkspaceRef) =>
        run(async (): Promise<Workspace> => {
          const result = await trpc.workspace.getWorkspace.query({
            workspaceId: workspaceIdOf(ref),
          });
          const workspace = normalizeWorkspace(result.workspace as RawWorkspace);
          if (!workspace) throw new GittermError("NOT_FOUND", "Workspace not found");
          return workspace;
        }),
      getRuntimeAccess: (ref: WorkspaceRef) =>
        run(async (): Promise<WorkspaceRuntimeAccess> => {
          const result = await trpc.workspace.getRuntimeAccess.query({
            workspaceId: workspaceIdOf(ref),
          });
          return normalizeRuntime(result);
        }),
      ensureRunning: (ref: WorkspaceRef, options?: WaitOptions) =>
        run(async (): Promise<WorkspaceEnsureRunningResult> => {
          throwIfAborted(options?.signal, "ensuring the workspace is running");
          const result = await trpc.workspace.ensureRunning.mutate(
            {
              workspaceId: workspaceIdOf(ref),
              timeoutMs: options?.timeoutMs,
              pollIntervalMs: options?.pollIntervalMs,
            },
            { signal: options?.signal },
          );
          const workspace = normalizeWorkspace(result.workspace as RawWorkspace);
          if (!workspace) throw new GittermError("SERVER_ERROR", "ensureRunning failed");
          return {
            workspace,
            runtime: normalizeRuntime(result.runtime),
          };
        }),
      pause: (ref: WorkspaceRef) =>
        run(async (): Promise<WorkspacePauseResult> => {
          const result = await trpc.workspace.pauseWorkspace.mutate({
            workspaceId: workspaceIdOf(ref),
          });
          return { durationMinutes: result.durationMinutes };
        }),
      restart: (ref: WorkspaceRef) =>
        run(async (): Promise<WorkspaceRestartResult> => {
          const result = await trpc.workspace.restartWorkspace.mutate({
            workspaceId: workspaceIdOf(ref),
          });
          return { status: result.status as Workspace["status"] };
        }),
      terminate: (ref: WorkspaceRef) =>
        run(async (): Promise<WorkspaceTerminateResult> => {
          const result = await trpc.workspace.deleteWorkspace.mutate({
            workspaceId: workspaceIdOf(ref),
          });
          return {
            workspace: normalizeWorkspace(result.workspace),
            cleanupInBackground: result.cleanupInBackground,
          };
        }),
      create: createWorkspace,
      setupStatus: (ref: WorkspaceRef) =>
        run(async () => trpc.workspace.getSetupStatus.query({ workspaceId: workspaceIdOf(ref) })),
      waitForSetup: (ref: WorkspaceRef, waitOptions?: WaitOptions) =>
        run(() => waitForWorkspaceSetup(workspaceIdOf(ref), waitOptions)),
    },
    runs: {
      create: (input: AgentRunCreateInput) =>
        run(async (): Promise<AgentRun> => {
          const { signal, ...request } = input;
          // Setup can legitimately take longer than one HTTP request should be
          // held open, so poll it from here and let the server do a final check.
          if (request.waitForSetup) {
            await waitForWorkspaceSetup(request.workspaceId, {
              timeoutMs: request.setupTimeoutMs,
              signal,
            });
          }
          throwIfAborted(signal, "creating the run");
          return trpc.run.create.mutate(
            { ...request, idempotencyKey: request.idempotencyKey ?? crypto.randomUUID() },
            { signal },
          ) as Promise<AgentRun>;
        }),
      list: (ref: WorkspaceRef, options?: AgentRunListOptions) =>
        run(
          async (): Promise<AgentRunListResult> =>
            trpc.run.list.query({
              workspaceId: workspaceIdOf(ref),
              ...options,
            }) as Promise<AgentRunListResult>,
        ),
      get: (refOrWorkspaceId: RunRef | string, runId?: string) =>
        run(async (): Promise<AgentRun> => {
          const target = runTargetOf(refOrWorkspaceId, runId);
          return trpc.run.get.query(target) as Promise<AgentRun>;
        }),
      messages: (refOrWorkspaceId: RunRef | string, runId?: string) =>
        run(async (): Promise<AgentRunMessage[]> => {
          const target = runTargetOf(refOrWorkspaceId, runId);
          const messages = (await trpc.run.messages.query(target)) as Array<
            Omit<AgentRunMessage, "parts"> & { parts?: AgentRunMessage["parts"] }
          >;
          return messages.map((message) => ({ ...message, parts: message.parts ?? [] }));
        }),
      cancel: (refOrWorkspaceId: RunRef | string, runId?: string) =>
        run(async () => trpc.run.cancel.mutate(runTargetOf(refOrWorkspaceId, runId))),
      wait: (
        refOrWorkspaceId: RunRef | string,
        runIdOrOptions?: string | WaitOptions,
        maybeOptions?: WaitOptions,
      ) =>
        run(async (): Promise<AgentRun> => {
          const target =
            typeof refOrWorkspaceId === "string"
              ? runTargetOf(refOrWorkspaceId, runIdOrOptions as string | undefined)
              : runTargetOf(refOrWorkspaceId);
          const waitOptions =
            typeof refOrWorkspaceId === "string"
              ? maybeOptions
              : (runIdOrOptions as WaitOptions | undefined);
          const timeoutMs = waitOptions?.timeoutMs ?? 30 * 60_000;
          const pollIntervalMs = waitOptions?.pollIntervalMs ?? 2_000;
          const signal = waitOptions?.signal;
          const deadline = Date.now() + timeoutMs;
          while (true) {
            throwIfAborted(signal, `waiting for run ${target.runId}`);
            const result = (await trpc.run.get.query(target, { signal })) as AgentRun;
            if (
              result.status !== "pending" &&
              result.status !== "running" &&
              result.status !== "retrying"
            )
              return result;
            if (Date.now() >= deadline) {
              throw new GittermError("NETWORK", `Timed out waiting for run ${target.runId}`);
            }
            await sleep(pollIntervalMs, signal, `waiting for run ${target.runId}`);
          }
        }),
    },
    catalog: {
      agentTypes: (input?: { serverOnly?: boolean }): Promise<AgentType[]> =>
        run(async () => {
          const result = await trpc.workspace.listAgentTypes.query(input);
          return result.agentTypes;
        }),
      cloudProviders: (input?: {
        localOnly?: boolean;
        cloudOnly?: boolean;
        sandboxOnly?: boolean;
        nonSandboxOnly?: boolean;
      }): Promise<CloudProvider[]> =>
        run(async () => {
          const result = await trpc.workspace.listCloudProviders.query(input);
          return result.cloudProviders;
        }),
      workspaceOptions: (): Promise<WorkspaceCatalog> =>
        run(async () => trpc.workspace.getWorkspaceCatalog.query()),
    },
    credentials: {
      list: () =>
        run(async (): Promise<ModelCredential[]> => {
          const result = await trpc.modelCredentials.listMyCredentials.query();
          return result.credentials.map((credential) => ({
            ...credential,
            lastUsedAt: toIso(credential.lastUsedAt),
            oauthExpiresAt: toIso(credential.oauthExpiresAt),
            createdAt: toIso(credential.createdAt)!,
            updatedAt: toIso(credential.updatedAt)!,
          }));
        }),
      listProviders: () =>
        run(async (): Promise<ModelProviderInfo[]> => {
          const result = await trpc.modelCredentials.listProviders.query();
          return result.providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            displayName: provider.displayName,
            authType: provider.authType,
            isRecommended: provider.isRecommended,
          }));
        }),
    },
  };
}
