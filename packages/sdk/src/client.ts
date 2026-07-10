import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "@gitterm/api/routers/index";
import { loadConfigSync } from "./config.js";
import { GittermError, type GittermErrorCode } from "./errors.js";
import type {
  AgentType,
  AuthStatus,
  CloudProvider,
  Workspace,
  WorkspaceCreateInput,
  WorkspaceCreateResult,
  WorkspaceEnsureRunningResult,
  WorkspaceListOptions,
  WorkspaceListResult,
  WorkspaceRestartResult,
  WorkspaceRuntimeAccess,
  WorkspacePauseResult,
  WorkspaceTerminateResult,
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
  startedAt: Date | string | null;
  stoppedAt: Date | string | null;
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

function envValue(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env[name] : undefined;
  return value && value.trim() ? value : undefined;
}

function resolveCredentials(options: GittermClientOptions): Credentials {
  const config = !options.serverUrl || !options.token ? loadConfigSync(options.configPath) : null;
  const serverUrl = options.serverUrl ?? envValue("GITTERM_SERVER_URL") ?? config?.serverUrl;
  const token = options.token ?? envValue("GITTERM_API_TOKEN") ?? config?.token;

  if (!serverUrl || !token) {
    throw new GittermError("NOT_LOGGED_IN", "Not logged in. Run: gitterm login");
  }

  return { serverUrl, token };
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
    startedAt: toIso(workspace.startedAt),
    stoppedAt: toIso(workspace.stoppedAt),
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
    default:
      return "SERVER_ERROR";
  }
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
      throw new GittermError(
        code,
        code === "UNAUTHORIZED"
          ? "Not logged in or token expired. Run: gitterm login"
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

export function createGittermClient(options: GittermClientOptions = {}) {
  const credentials = resolveCredentials(options);
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: toTrpcUrl(credentials.serverUrl),
        fetch: options.fetch as HttpBatchLinkOptions["fetch"],
        headers: () => ({ authorization: `Bearer ${credentials.token}` }),
      }),
    ],
  });

  const run = <T>(operation: () => Promise<T>) => runWithServer(credentials.serverUrl, operation);

  const createWorkspace = (input: WorkspaceCreateInput) =>
    run(async (): Promise<WorkspaceCreateResult> => {
      const result = await trpc.workspace.createWorkspace.mutate(input);
      const workspace = normalizeWorkspace(result.workspace as RawWorkspace);
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
    });

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
            workspaces: result.workspaces.map(
              (workspace: RawWorkspace) => normalizeWorkspace(workspace)!,
            ),
            pagination: result.pagination,
          };
        }),
      get: (workspaceId: string) =>
        run(async (): Promise<Workspace> => {
          const result = await trpc.workspace.getWorkspace.query({ workspaceId });
          const workspace = normalizeWorkspace(result.workspace);
          if (!workspace) throw new GittermError("NOT_FOUND", "Workspace not found");
          return workspace;
        }),
      getRuntimeAccess: (workspaceId: string) =>
        run(async (): Promise<WorkspaceRuntimeAccess> => {
          const result = await trpc.workspace.getRuntimeAccess.query({ workspaceId });
          return normalizeRuntime(result);
        }),
      ensureRunning: (
        workspaceId: string,
        options?: { timeoutMs?: number; pollIntervalMs?: number },
      ) =>
        run(async (): Promise<WorkspaceEnsureRunningResult> => {
          const result = await trpc.workspace.ensureRunning.mutate({
            workspaceId,
            timeoutMs: options?.timeoutMs,
            pollIntervalMs: options?.pollIntervalMs,
          });
          const workspace = normalizeWorkspace(result.workspace as RawWorkspace);
          if (!workspace) throw new GittermError("SERVER_ERROR", "ensureRunning failed");
          return {
            workspace,
            runtime: normalizeRuntime(result.runtime),
          };
        }),
      pause: (workspaceId: string) =>
        run(async (): Promise<WorkspacePauseResult> => {
          const result = await trpc.workspace.pauseWorkspace.mutate({ workspaceId });
          return { durationMinutes: result.durationMinutes };
        }),
      restart: (workspaceId: string) =>
        run(async (): Promise<WorkspaceRestartResult> => {
          const result = await trpc.workspace.restartWorkspace.mutate({ workspaceId });
          return { status: result.status };
        }),
      terminate: (workspaceId: string) =>
        run(async (): Promise<WorkspaceTerminateResult> => {
          const result = await trpc.workspace.deleteWorkspace.mutate({ workspaceId });
          return {
            workspace: normalizeWorkspace(result.workspace),
            cleanupInBackground: result.cleanupInBackground,
          };
        }),
      create: createWorkspace,
      /** Alias for create — preferred name for sandbox/plugin callers. */
      createSandbox: createWorkspace,
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
    },
  };
}

export type GittermClient = ReturnType<typeof createGittermClient>;

// TODO: Publishing @gitterm/sdk publicly needs bundled .d.ts output or a trimmed
// public router type so external users do not need the private @gitterm/api package.
