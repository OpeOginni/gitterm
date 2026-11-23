import { GittermError, type GittermClient, type WorkspaceProviderSelection } from "@gitterm/sdk";
import { RepositoryUnreachable, type Cloud } from "./flows.js";
import { remoteMachine } from "./machine.js";

/** Providers that can't run commands in a workspace, which most agents' moves need. */
const NO_EXEC = new Set(["aws"]);

const unreachableRepository = (error: unknown) =>
  error instanceof GittermError &&
  error.code === "BAD_REQUEST" &&
  /^(Can't access repository|Can't clone repository|The admin's shared GitHub token|Invalid repository URL)/.test(
    error.message,
  );

const INTEGRATION_KEYS = new Set(["github", "google", "gitlab", "bitbucket", "executor", "mcp"]);

/** GitTerm rejects a GitHub connection on a workspace without a repository; others are kept. */
export async function withoutGithub(
  gitterm: GittermClient,
  references: string[] | undefined,
): Promise<string[] | undefined> {
  if (!references?.length) return references;
  const key = (reference: string) => reference.trim().toLowerCase();
  const kept = references.filter((reference) => key(reference) !== "github");
  if (kept.every((reference) => INTEGRATION_KEYS.has(key(reference)))) return kept;
  const github = await gitterm.integrations.connections
    .list({ integration: "github" })
    .catch(() => []);
  return kept.filter((reference) => {
    const wanted = reference.trim();
    return (
      INTEGRATION_KEYS.has(key(reference)) ||
      !github.some((c) => c.id === wanted || c.name.toLowerCase() === key(reference))
    );
  });
}

export type GittermCloudOptions = {
  provider?: string | WorkspaceProviderSelection;
  persistent?: boolean;
  /** Connections to attach, by name or id. */
  connections?: string[];
  /** Env the workspace gets, e.g. from the checkout's env files. */
  environmentVariables?: Record<string, string>;
  /** Start from the user's saved project snapshot when there is one. */
  projectSnapshots?: boolean;
};

/** Agent workspaces on GitTerm. */
export function gittermCloud(client: GittermClient, options: GittermCloudOptions = {}): Cloud {
  const provider =
    typeof options.provider === "string"
      ? ({ type: options.provider } as WorkspaceProviderSelection)
      : options.provider;
  return {
    async create(input) {
      const connections = input.repo
        ? options.connections
        : await withoutGithub(client, options.connections);
      const create = (useProjectSnapshot: boolean) =>
        client.workspaces.create({
          ...input,
          // A failed snapshot start must not be reused for the fresh attempt.
          idempotencyKey: `${input.idempotencyKey}${useProjectSnapshot ? "" : ":fresh"}`,
          ...(provider ? { provider } : {}),
          ...(options.persistent !== undefined ? { persistent: options.persistent } : {}),
          ...(connections?.length ? { connections } : {}),
          ...(options.environmentVariables && Object.keys(options.environmentVariables).length
            ? { environmentVariables: options.environmentVariables }
            : {}),
          useProjectSnapshot,
        });
      try {
        if (options.projectSnapshots) {
          // A snapshot that no longer starts falls back to a fresh workspace.
          const fromSnapshot = await create(true).catch((error: unknown) => {
            if (error instanceof Error && error.message.includes("PROJECT_SNAPSHOT_FAILED"))
              return undefined;
            throw error;
          });
          if (fromSnapshot && fromSnapshot.workspace.status !== "terminated")
            return fromSnapshot.workspace.id;
        }
        return (await create(false)).workspace.id;
      } catch (error) {
        if (unreachableRepository(error)) throw new RepositoryUnreachable((error as Error).message);
        throw error;
      }
    },
    async ready(workspaceId, signal) {
      await client.workspaces.ensureRunning(workspaceId, signal ? { signal } : undefined);
      const runtime = await client.workspaces.getRuntimeAccess(workspaceId);
      if (!runtime.url) throw new Error("The workspace has no public URL.");
      return {
        url: runtime.url,
        directory: runtime.directory,
        ...(runtime.headers ? { headers: runtime.headers } : {}),
        ...(runtime.password ? { password: runtime.password } : {}),
        canExec: !runtime.providerKey || !NO_EXEC.has(runtime.providerKey),
      };
    },
    machine: (workspaceId) =>
      remoteMachine((command) => client.workspaces.exec(workspaceId, command)),
    async end(workspaceId, how) {
      if (how === "pause") await client.workspaces.pause(workspaceId);
      else await client.workspaces.terminate(workspaceId);
    },
  };
}
