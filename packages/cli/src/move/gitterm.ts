import { GittermError, type GittermClient, type WorkspaceProviderSelection } from "@gitterm/sdk";
import { RepositoryUnreachable, type Cloud } from "./flows.js";
import { remoteMachine } from "./machine.js";

/** Providers that can't run commands in a workspace, which moving needs. */
const NO_EXEC = new Set(["aws"]);

const unreachableRepository = (error: unknown) =>
  error instanceof GittermError &&
  error.code === "BAD_REQUEST" &&
  /^(Can't access repository|Can't clone repository|The admin's shared GitHub token|Invalid repository URL)/.test(
    error.message,
  );

/** Agent workspaces on GitTerm. */
export function gittermCloud(
  client: GittermClient,
  options: { provider?: string; connections?: string[] } = {},
): Cloud {
  if (options.provider && NO_EXEC.has(options.provider))
    throw new Error(
      `${options.provider} workspaces can't run the commands this needs. Pick another provider.`,
    );
  return {
    async create(input) {
      try {
        const created = await client.workspaces.create({
          ...input,
          ...(options.provider
            ? { provider: { type: options.provider } as WorkspaceProviderSelection }
            : {}),
          // GitTerm rejects a GitHub connection on a workspace without a repository.
          ...(options.connections?.length && input.repo
            ? { connections: options.connections }
            : {}),
        });
        return created.workspace.id;
      } catch (error) {
        if (unreachableRepository(error)) throw new RepositoryUnreachable((error as Error).message);
        throw error;
      }
    },
    async ready(workspaceId) {
      const { runtime } = await client.workspaces.ensureRunning(workspaceId);
      if (!runtime.url) throw new Error("The workspace has no public URL.");
      if (runtime.providerKey && NO_EXEC.has(runtime.providerKey))
        throw new Error(
          `This workspace runs on ${runtime.providerKey}, which can't run the commands this needs. Pick another provider.`,
        );
      return { url: runtime.url, directory: runtime.directory };
    },
    machine: (workspaceId) =>
      remoteMachine((command) => client.workspaces.exec(workspaceId, command)),
    async end(workspaceId, how) {
      if (how === "pause") await client.workspaces.pause(workspaceId);
      else await client.workspaces.terminate(workspaceId);
    },
  };
}
