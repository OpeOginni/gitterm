import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClientError,
} from "@trpc/client";
import type { AppRouter } from "@gitterm/api/routers/index";
import { EventSource } from "eventsource";
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
  AgentRunReply,
  AuthStatus,
  CloudProvider,
  RunRef,
  RunWaitOptions,
  RunWatchOptions,
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
import { runHelpers } from "./runs.js";
import type {
  AgentRunEvent,
  AgentRunResult,
  RunResultOptions,
  ModelInfo,
  WorkspaceModelAccess,
} from "./types.js";

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
  opencodeApi?: Workspace["opencodeApi"] | null;
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
    /** Credential-source metadata and known models; never wakes the runtime. */
    models(workspace: WorkspaceRef): Promise<WorkspaceModelAccess>;
    waitForSetup(workspace: WorkspaceRef, options?: WaitOptions): Promise<WorkspaceSetupStatus>;
  };
  runs: {
    create(input: AgentRunCreateInput): Promise<AgentRun>;
    list(workspace: WorkspaceRef, options?: AgentRunListOptions): Promise<AgentRunListResult>;
    get(run: RunRef): Promise<AgentRun>;
    messages(run: RunRef): Promise<AgentRunMessage[]>;
    cancel(run: RunRef): Promise<{ cancelled: boolean }>;
    /** Answer the permission prompt or question a run is `awaiting_input` on. */
    respond(run: RunRef, input: { requestId: string; reply: AgentRunReply }): Promise<AgentRun>;
    /**
     * Every lifecycle state of the run, starting with its current one, until a
     * terminal state is yielded. Push-based (server-sent events); no polling.
     * Answer `awaiting_input` states with `runs.respond()` while iterating.
     */
    watch(run: RunRef, options?: RunWatchOptions): AsyncIterable<AgentRun>;
    /**
     * Resolve with the first state that needs attention: terminal, or
     * `awaiting_input` unless `until: "terminal"`. A thin helper over `watch()`.
     */
    wait(run: RunRef, options?: RunWaitOptions): Promise<AgentRun>;
    events(run: RunRef, options?: RunWatchOptions): AsyncIterable<AgentRunEvent>;
    result(run: RunRef, options?: RunResultOptions): Promise<AgentRunResult>;
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
  models: { list(options?: { provider?: string }): Promise<ModelInfo[]> };
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

function runTargetOf(ref: RunRef) {
  return { workspaceId: ref.workspaceId, runId: ref.id };
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
    opencodeApi: workspace.opencodeApi ?? "v1",
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
    case "TIMEOUT":
      return "TIMEOUT";
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

function toGittermError(serverUrl: string, error: unknown): GittermError {
  if (error instanceof GittermError) return error;

  if (error instanceof TRPCClientError) {
    const data = error.data as { code?: string; workspaceLifecycleCode?: unknown } | undefined;
    const trpcCode = data?.code;
    // No error envelope means the request never produced a tRPC response
    // (connection refused, DNS failure, non-tRPC proxy error, ...).
    if (!error.data) {
      return new GittermError("NETWORK", `Could not reach the GitTerm server at ${serverUrl}`, {
        cause: error,
      });
    }
    const code = mapTrpcCode(trpcCode);
    const structuredLifecycleCode = WORKSPACE_LIFECYCLE_ERROR_CODES.find(
      (candidate) => candidate === data?.workspaceLifecycleCode,
    );
    if (structuredLifecycleCode) {
      return new WorkspaceLifecycleError(structuredLifecycleCode, error.message, { cause: error });
    }
    if (error.message.startsWith("INPUT_NOT_PENDING:"))
      return new GittermError("INPUT_NOT_PENDING", error.message, { cause: error });
    const credentialCode = credentialErrorCode(error.message);
    if (credentialCode) return new GittermError(credentialCode, error.message, { cause: error });
    const lifecycleCode = WORKSPACE_LIFECYCLE_ERROR_CODES.find((candidate) =>
      error.message.startsWith(`${candidate}:`),
    );
    if (lifecycleCode) {
      return new WorkspaceLifecycleError(lifecycleCode, error.message, { cause: error });
    }
    return new GittermError(
      code,
      code === "UNAUTHORIZED"
        ? `Authentication failed: ${error.message}. Check that the API token is valid and has not expired.`
        : error.message,
      { cause: error },
    );
  }

  return new GittermError(
    "NETWORK",
    error instanceof Error ? error.message : "Network request failed",
    { cause: error },
  );
}

async function runWithServer<T>(serverUrl: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toGittermError(serverUrl, error);
  }
}

type RunLifecycleEvent =
  | { type: "snapshot"; run: AgentRun }
  | { type: "run.updated"; run: AgentRun };

type RunTarget = { workspaceId: string; runId: string };
type Trpc = ReturnType<typeof createTRPCClient<AppRouter>>;

function isTerminalRun(status: AgentRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/** Yields each lifecycle state from the subscription until the run is terminal. */
async function* watchRun(
  trpc: Trpc,
  serverUrl: string,
  target: RunTarget,
  options?: RunWatchOptions,
): AsyncGenerator<AgentRun> {
  const what = `watching run ${target.runId}`;
  throwIfAborted(options?.signal, what);

  type Item = { run: AgentRun } | { error: unknown } | { done: true };
  const queue: Item[] = [];
  let wake: (() => void) | undefined;
  const push = (item: Item) => {
    queue.push(item);
    wake?.();
    wake = undefined;
  };
  const onAbort = () => push({ error: new GittermError("ABORTED", `Aborted while ${what}`) });
  options?.signal?.addEventListener("abort", onAbort, { once: true });

  let last: AgentRun | undefined;
  const subscription = trpc.run.lifecycle.subscribe(target, {
    onData: (event) => {
      last = (event as RunLifecycleEvent).run;
      push({ run: last });
    },
    onError: (error) => push({ error }),
    onComplete: () =>
      push(
        last && isTerminalRun(last.status)
          ? { done: true }
          : {
              error: new GittermError(
                "NETWORK",
                `Run ${target.runId} event stream ended unexpectedly`,
              ),
            },
      ),
  });

  try {
    while (true) {
      throwIfAborted(options?.signal, what);
      if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
      const item = queue.shift()!;
      if ("done" in item) return;
      if ("error" in item) throw toGittermError(serverUrl, item.error);
      yield item.run;
      if (isTerminalRun(item.run.status)) return;
    }
  } finally {
    options?.signal?.removeEventListener("abort", onAbort);
    subscription.unsubscribe();
  }
}

export function createGittermClient(options: GittermClientOptions = {}): GittermClient {
  const credentials = resolveCredentials(options);
  const fetchImpl = createNoRedirectFetch(options.fetch);
  const authorization = `Bearer ${credentials.token}`;
  const trpc = createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (operation) => operation.type === "subscription",
        // EventSource cannot set headers itself, so the ponyfill's fetch adds the token.
        true: httpSubscriptionLink({
          url: toTrpcUrl(credentials.serverUrl),
          EventSource,
          eventSourceOptions: {
            fetch: (url, init) =>
              fetchImpl(url, { ...init, headers: { ...init.headers, authorization } }),
          },
        }),
        false: httpBatchLink({
          url: toTrpcUrl(credentials.serverUrl),
          fetch: fetchImpl as HttpBatchLinkOptions["fetch"],
          headers: () => ({ authorization }),
        }),
      }),
    ],
  });

  const run = <T>(operation: () => Promise<T>) => runWithServer(credentials.serverUrl, operation);
  const watch = (ref: RunRef, watchOptions?: RunWatchOptions) =>
    watchRun(trpc, credentials.serverUrl, runTargetOf(ref), watchOptions);
  const respond = (ref: RunRef, input: { requestId: string; reply: AgentRunReply }) =>
    run(
      async (): Promise<AgentRun> =>
        trpc.run.respond.mutate({ ...runTargetOf(ref), ...input }) as Promise<AgentRun>,
    );

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
          "TIMEOUT",
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
      ensureRunning: (ref: WorkspaceRef, waitOptions?: WaitOptions) =>
        run(async (): Promise<WorkspaceEnsureRunningResult> => {
          throwIfAborted(waitOptions?.signal, "ensuring the workspace is running");
          const result = await trpc.workspace.ensureRunning.mutate(
            {
              workspaceId: workspaceIdOf(ref),
              timeoutMs: waitOptions?.timeoutMs,
              pollIntervalMs: waitOptions?.pollIntervalMs,
            },
            { signal: waitOptions?.signal },
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
      models: (ref) =>
        run(() => trpc.workspace.getModelAccess.query({ workspaceId: workspaceIdOf(ref) })),
      setupStatus: (ref: WorkspaceRef) =>
        run(async () => trpc.workspace.getSetupStatus.query({ workspaceId: workspaceIdOf(ref) })),
      waitForSetup: (ref: WorkspaceRef, waitOptions?: WaitOptions) =>
        run(() => waitForWorkspaceSetup(workspaceIdOf(ref), waitOptions)),
    },
    runs: {
      create: (input: AgentRunCreateInput) =>
        run(async (): Promise<AgentRun> => {
          const { signal, workspace, ...rest } = input;
          const request = {
            ...rest,
            workspaceId: workspaceIdOf(workspace),
            context:
              rest.context?.type === "continue"
                ? { type: "continue" as const, runId: rest.context.run.id }
                : rest.context,
          };
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
      list: (ref: WorkspaceRef, listOptions?: AgentRunListOptions) =>
        run(
          async (): Promise<AgentRunListResult> =>
            trpc.run.list.query({
              workspaceId: workspaceIdOf(ref),
              ...listOptions,
            }) as Promise<AgentRunListResult>,
        ),
      get: (ref: RunRef) =>
        run(
          async (): Promise<AgentRun> => trpc.run.get.query(runTargetOf(ref)) as Promise<AgentRun>,
        ),
      messages: (ref: RunRef) =>
        run(async (): Promise<AgentRunMessage[]> => {
          const messages = (await trpc.run.messages.query(runTargetOf(ref))) as Array<
            Omit<AgentRunMessage, "parts"> & { parts?: AgentRunMessage["parts"] }
          >;
          return messages.map((message) => ({ ...message, parts: message.parts ?? [] }));
        }),
      cancel: (ref: RunRef) => run(async () => trpc.run.cancel.mutate(runTargetOf(ref))),
      respond,
      watch,
      ...runHelpers({ watch, respond }),
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
    models: {
      list: (listOptions) =>
        run(async () => {
          const result = await trpc.modelCredentials.listModels.query();
          return result.models
            .map((model) => ({
              id: model.modelId,
              name: model.displayName,
              provider: model.modelId.slice(0, model.modelId.indexOf("/")),
              isFree: model.isFree,
              isRecommended: model.isRecommended,
            }))
            .filter((model) => !listOptions?.provider || model.provider === listOptions.provider);
        }),
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
            logicalProviderKey: provider.logicalProviderKey,
            displayName: provider.displayName,
            authType: provider.authType,
            isRecommended: provider.isRecommended,
          }));
        }),
    },
  };
}
