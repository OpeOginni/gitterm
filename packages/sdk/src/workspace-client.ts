import { TRPCClientError, createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@gitterm/api/routers/index";
import { GittermError, type GittermErrorCode } from "./errors.js";
import { createNoRedirectFetch, normalizeServerUrl } from "./transport.js";

export type WorkspaceEnvironment = {
  serverUrl: string;
  token: string;
  workspaceId: string;
};

export type WorkspaceSelf = {
  id: string;
  name: string | null;
  status: "pending" | "running" | "paused" | "terminated";
  repositoryUrl: string | null;
  repositoryBranch: string | null;
  baseCommit: string | null;
  checkoutRef: string | null;
  providerKey: string | null;
  url: string | null;
  ports: WorkspacePort[];
};

export type WorkspacePort = { port: number; name: string | null; url: string | null };

export type WorkspaceClientOptions = Partial<WorkspaceEnvironment> & {
  fetch?: typeof globalThis.fetch;
};

export type GittermWorkspaceClient = {
  workspaceId: string;
  serverUrl: string;
  self: { get(): Promise<WorkspaceSelf> };
  ports: {
    list(): Promise<WorkspacePort[]>;
    open(port: number, options?: { name?: string }): Promise<WorkspacePort>;
    close(port: number): Promise<{ port: number; closed: boolean }>;
  };
};

export function getWorkspaceEnvironment(
  environment?: Record<string, string | undefined>,
): WorkspaceEnvironment | null {
  environment ??= typeof process === "undefined" ? {} : process.env;
  const serverUrl = environment.WORKSPACE_API_URL;
  const token = environment.WORKSPACE_AUTH_TOKEN;
  const workspaceId = environment.WORKSPACE_ID;
  const workspaceEnvironmentPresent = Boolean(serverUrl || token || workspaceId);
  if (!workspaceEnvironmentPresent) return null;
  if (!serverUrl || !token || !workspaceId) {
    throw new GittermError(
      "UNAUTHORIZED",
      "Incomplete GitTerm workspace environment: WORKSPACE_API_URL, WORKSPACE_AUTH_TOKEN, and WORKSPACE_ID are required",
    );
  }
  return { serverUrl: normalizeServerUrl(serverUrl), token, workspaceId };
}

function errorCode(code: string | undefined): GittermErrorCode {
  if (code === "UNAUTHORIZED" || code === "NOT_FOUND" || code === "FORBIDDEN") return code;
  if (code === "BAD_REQUEST") return code;
  return "SERVER_ERROR";
}

export function createGittermWorkspaceClient(
  options: WorkspaceClientOptions = {},
): GittermWorkspaceClient {
  const detected =
    options.serverUrl && options.token && options.workspaceId ? null : getWorkspaceEnvironment();
  const rawServerUrl = options.serverUrl ?? detected?.serverUrl;
  const token = options.token ?? detected?.token;
  const workspaceId = options.workspaceId ?? detected?.workspaceId;
  if (!rawServerUrl || !token || !workspaceId) {
    throw new GittermError("UNAUTHORIZED", "This command must run inside a GitTerm workspace");
  }
  const serverUrl = normalizeServerUrl(rawServerUrl);

  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: new URL("/trpc", serverUrl).toString(),
        fetch: createNoRedirectFetch(options.fetch),
        headers: () => ({ authorization: `Bearer ${token}` }),
      }),
    ],
  });

  async function run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof TRPCClientError) {
        throw new GittermError(errorCode(error.data?.code), error.message, { cause: error });
      }
      throw new GittermError(
        "NETWORK",
        error instanceof Error ? error.message : "Network request failed",
        { cause: error },
      );
    }
  }

  return {
    workspaceId,
    serverUrl,
    self: { get: () => run(() => trpc.workspaceOps.getSelf.query()) },
    ports: {
      list: () => run(() => trpc.workspaceOps.listPorts.query()),
      open: (port, input) => run(() => trpc.workspaceOps.openPort.mutate({ port, ...input })),
      close: (port) => run(() => trpc.workspaceOps.closePort.mutate({ port })),
    },
  };
}
