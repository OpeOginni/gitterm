import type { Plugin, PluginInput, WorkspaceInfo } from "@opencode-ai/plugin";
import { createGittermClient, type GittermClient, type WorkspaceCreateResult } from "@gitterm/sdk";

type GittermExtra = {
  workspaceID?: string;
  repo?: string;
  branch?: string;
  baseCommit?: string;
  checkoutRef?: string;
};

type GittermOptions = {
  serverUrl?: string;
  token?: string;
  regionId?: string;
  persistent?: boolean;
  workspaceProfile?: "standard" | "ssh-enabled";
  name?: string;
  repo?: string;
  branch?: string;
};

type MovedProperties = {
  source?: { directory?: string; workspaceID?: string };
  location?: { directory?: string; workspaceID?: string };
};

const AGENT = "Opencode (Beta Workspaces)";
const PROVIDER = "e2b";

export const GittermWorkspacePlugin: Plugin = async (
  { experimental_workspace, $, directory },
  options,
) => {
  const config = options as GittermOptions | undefined;
  const sandboxByWorkspace = new Map<string, string>();
  const rememberSandbox = (info: WorkspaceInfo) => {
    const sandboxID = readExtra(info).workspaceID;
    if (sandboxID) sandboxByWorkspace.set(info.id, sandboxID);
    return sandboxID;
  };

  experimental_workspace.register("gitterm", {
    kind: "remote",
    name: "Gitterm",
    description: "Create and connect to a Gitterm sandbox",
    async configure(info: WorkspaceInfo) {
      const repo = config?.repo ?? (await git($, directory, ["remote", "get-url", "origin"]));
      const branch =
        config?.branch ?? info.branch ?? (await git($, directory, ["branch", "--show-current"]));
      const baseCommit = await git($, directory, ["rev-parse", "HEAD"]);
      return {
        ...info,
        branch,
        name: config?.name ?? info.name,
        extra: {
          ...(isObject(info.extra) ? info.extra : {}),
          repo,
          branch,
          baseCommit,
        } satisfies GittermExtra,
      };
    },
    async create(info: WorkspaceInfo) {
      const client = clientFor(config);
      const extra = readExtra(info);
      const result = normalizeCreateResult(
        await client.workspaces.createSandbox({
          idempotencyKey: `${info.id}:${extra.baseCommit}`,
          name: info.name,
          repo: extra.repo,
          branch: extra.branch ?? info.branch ?? undefined,
          baseCommit: extra.baseCommit,
          checkoutRef: extra.checkoutRef,
          agent: AGENT,
          provider: PROVIDER,
          regionId: config?.regionId,
          persistent: config?.persistent ?? false,
          workspaceProfile: config?.workspaceProfile ?? "standard",
        }),
      );
      const created: WorkspaceInfo = {
        ...info,
        name: result.workspace.name ?? info.name,
        branch: result.workspace.repositoryBranch ?? info.branch,
        directory: result.runtime.directory,
        extra: {
          ...extra,
          workspaceID: result.workspace.id,
          repo: result.runtime.repo ?? extra.repo,
          branch: result.runtime.branch ?? extra.branch,
          baseCommit: result.runtime.baseCommit ?? extra.baseCommit,
          ...((result.runtime.checkoutRef ?? extra.checkoutRef)
            ? { checkoutRef: result.runtime.checkoutRef ?? extra.checkoutRef }
            : {}),
        } satisfies GittermExtra,
      };
      rememberSandbox(created);
      return created;
    },
    async remove(info: WorkspaceInfo) {
      const sandboxID = rememberSandbox(info);
      if (!sandboxID) return;
      sandboxByWorkspace.delete(info.id);
      await clientFor(config).workspaces.terminate(sandboxID);
    },
    async status(info: WorkspaceInfo) {
      const extra = readExtra(info);
      rememberSandbox(info);
      if (!extra.workspaceID) return "disconnected";
      const runtime = await requireGetRuntimeAccess(clientFor(config), extra.workspaceID);
      if (runtime.status === "running") return "connected";
      if (runtime.status === "paused") return "paused";
      if (runtime.status === "pending") return "connecting";
      if (runtime.status === "terminated") return "error";
      return "disconnected";
    },
    async ensureReady(info: WorkspaceInfo) {
      const extra = readExtra(info);
      rememberSandbox(info);
      const workspaceID = requireWorkspaceID(extra);
      const client = clientFor(config);
      const runtime = await requireGetRuntimeAccess(client, workspaceID);
      if (runtime.status === "running") return;
      if (runtime.status === "terminated")
        throw new Error(`Gitterm workspace ${workspaceID} is terminated`);
      if (!runtime.recoverable)
        throw new Error(`Gitterm workspace ${workspaceID} is not recoverable`);
      await client.workspaces.ensureRunning(workspaceID);
    },
    async target(info: WorkspaceInfo) {
      const extra = readExtra(info);
      rememberSandbox(info);
      const workspaceID = requireWorkspaceID(extra);
      const runtime = await requireGetRuntimeAccess(clientFor(config), workspaceID);
      if (runtime.status !== "running")
        throw new Error(`Gitterm workspace ${workspaceID} is not running`);
      if (!runtime.url)
        throw new Error(`Gitterm workspace ${workspaceID} does not expose a runtime URL`);
      return {
        type: "remote",
        url: runtime.url,
        headers: requireRuntimeHeaders(runtime, workspaceID),
      };
    },
    // OpenCode's published stable types do not yet include the beta workspace
    // lifecycle hooks (`status` and `ensureReady`) or a `create` return value.
  } as unknown as Parameters<PluginInput["experimental_workspace"]["register"]>[1]);

  return {
    async event({ event }) {
      const moved = event as { type?: string; properties?: MovedProperties };
      if (!moved.type?.startsWith("session.next.moved")) return;
      const sourceWorkspaceID = moved.properties?.source?.workspaceID;
      if (!sourceWorkspaceID || moved.properties?.location?.workspaceID) return;
      const sandboxID = sandboxByWorkspace.get(sourceWorkspaceID);
      if (!sandboxID) return;
      sandboxByWorkspace.delete(sourceWorkspaceID);
      // Removing the workspace record tears the sandbox down through this
      // adapter's remove() AND clears the entry from workspace listings.
      // Published stable plugin types may predate remove(); fall back to
      // terminating the sandbox directly on older opencode versions.
      const removeWorkspace = (
        experimental_workspace as { remove?: (workspaceID: string) => Promise<void> }
      ).remove;
      if (removeWorkspace) {
        try {
          await removeWorkspace(sourceWorkspaceID);
          return;
        } catch (error) {
          console.error("Gitterm: workspace remove failed; terminating sandbox directly", error);
        }
      }
      try {
        await clientFor(config).workspaces.terminate(sandboxID);
      } catch (error) {
        console.error(
          `Gitterm: failed to terminate sandbox ${sandboxID} after move back to local`,
          error,
        );
      }
    },
  };
};

function clientFor(options: GittermOptions | undefined) {
  return createGittermClient({
    serverUrl: options?.serverUrl,
    token: options?.token ?? process.env.GITTERM_API_TOKEN,
  });
}

async function requireGetRuntimeAccess(client: GittermClient, workspaceID: string) {
  return client.workspaces.getRuntimeAccess(workspaceID);
}

function normalizeCreateResult(result: WorkspaceCreateResult) {
  return result;
}

function readExtra(info: WorkspaceInfo): GittermExtra {
  if (!isObject(info.extra)) return {};
  return info.extra as GittermExtra;
}

function requireWorkspaceID(extra: GittermExtra) {
  if (!extra.workspaceID) throw new Error("Gitterm workspace has not been created yet");
  return extra.workspaceID;
}

function requireRuntimeHeaders(
  runtime: Awaited<ReturnType<GittermClient["workspaces"]["getRuntimeAccess"]>>,
  workspaceID: string,
) {
  const headers = runtimeHeaders(runtime);
  if (!hasAuthorization(headers)) {
    throw new Error(
      `Gitterm workspace ${workspaceID} did not return a server password or Authorization header. ` +
        "OpenCode remote serve requires Basic auth (OPENCODE_SERVER_PASSWORD).",
    );
  }
  return headers;
}

function runtimeHeaders(
  runtime: Awaited<ReturnType<GittermClient["workspaces"]["getRuntimeAccess"]>>,
) {
  const headers = normalizeHeaders(runtime.headers);
  const password = runtime.password?.trim();
  if (!password) return headers;
  headers.Authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  return headers;
}

function normalizeHeaders(input: HeadersInit | undefined) {
  const headers: Record<string, string> = {};
  if (!input) return headers;
  if (input instanceof Headers) {
    input.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }
  if (Array.isArray(input)) {
    for (const [key, value] of input) headers[key] = value;
    return headers;
  }
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") headers[key] = value;
  }
  return headers;
}

function hasAuthorization(headers: Record<string, string>) {
  return Object.entries(headers).some(
    ([key, value]) => key.toLowerCase() === "authorization" && value.trim().length > 0,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function git($: PluginInput["$"], cwd: string, args: string[]) {
  return (await $`git ${args}`.cwd(cwd).quiet().text()).trim();
}

export default GittermWorkspacePlugin;
