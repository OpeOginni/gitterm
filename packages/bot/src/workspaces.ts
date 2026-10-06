import type { GittermClient, ModelCredential, Workspace, WorkspaceModelsInput } from "@gitterm/sdk";
import type { StatusText } from "./status.js";
import type { BotLogger, ModelChoice, RepoTarget, WorkspaceOverrides } from "./types.js";

export type Repo = { url: string; branch: string | undefined };

/** Accepts `url`, `url#branch`, or `{ url, branch }`. */
export function parseRepo(target: RepoTarget): Repo {
  if (typeof target !== "string") return { url: target.url.trim(), branch: target.branch?.trim() };
  const [url = "", branch] = target.trim().split("#", 2);
  return { url, branch: branch || undefined };
}

export const repoKey = (repo: Repo) => (repo.branch ? `${repo.url}#${repo.branch}` : repo.url);

/** `acme/app` for display; the URL itself for anything that is not a recognisable host path. */
export function repoLabel(repo: Repo): string {
  const match = /^(?:https?:\/\/[^/]+\/|git@[^:]+:)(.+?)(?:\.git)?\/?$/.exec(repo.url);
  return match?.[1] ?? repo.url;
}

/**
 * Credentials for exactly the chosen model's provider, so a sandbox shared by a whole channel
 * holds one model key instead of every account on the dashboard. A provider without a saved
 * credential (free or ambient-auth models) gets none; a run that needs one then fails with the
 * provider's authentication error, and startup warns about it.
 */
export function modelsFor(model: ModelChoice, saved: ModelCredential[]): WorkspaceModelsInput {
  const provider = model.id.split("/")[0] ?? "";
  if (!provider || provider === model.id) {
    throw new Error(`The model "${model.id}" must look like provider/model`);
  }
  const only = (source: NonNullable<WorkspaceModelsInput["providers"]>[string]) => ({
    default: model.id,
    providers: { [provider]: source },
  });
  if (model.apiKey) return only({ source: "apiKey", apiKey: model.apiKey });
  if (model.credential) return only({ source: "saved", label: model.credential });
  const forProvider = saved.filter(
    (credential) => credential.logicalProviderKey === provider && credential.isActive,
  );
  if (forProvider.some((credential) => credential.isDefault)) return only({ source: "default" });
  if (forProvider.length > 0) {
    throw new Error(
      `Several saved ${provider} credentials and none is the default; pick one with \`credential\` (${forProvider.map((credential) => JSON.stringify(credential.label)).join(", ")})`,
    );
  }
  return { default: model.id };
}

/**
 * `["github"]` when GitTerm has a GitHub connection covering the repository (the server picks
 * it), otherwise nothing: a public repository still clones, and startup already warned.
 */
export async function githubFor(gitterm: GittermClient, repo: Repo): Promise<string[]> {
  return gitterm.integrations.connections.resolve(["github"], { repo: repo.url }).then(
    () => ["github"],
    () => [],
  );
}

const RESUME_TIMEOUT_MS = 5 * 60_000;

export type WorkspaceManager = {
  /** The repository's sandbox, found by its tags or created, and running. */
  ensure(repo: Repo, progress: (status: StatusText) => void): Promise<Workspace>;
  /** The repository's sandbox, if there is one, without waking it. */
  find(repo: Repo): Promise<Workspace | null>;
  /** Terminate the repository's sandbox; the next request creates a fresh one. */
  reset(repo: Repo): Promise<boolean>;
};

export function createWorkspaceManager(input: {
  gitterm: GittermClient;
  platform: string;
  scope: string;
  connections: string[];
  env: Record<string, string>;
  setup: string[];
  model: ModelChoice | undefined;
  instructions: string;
  overrides: WorkspaceOverrides | undefined;
  log: BotLogger;
}): WorkspaceManager {
  const { gitterm, log } = input;
  // The tags are the only record of which sandbox belongs to which repository, so a bot with
  // a lost state file, or on another machine, adopts its sandbox instead of leaking it.
  const tags = (repo: Repo) => ({
    "gitterm-bot": `${input.platform}:${input.scope}`,
    "gitterm-bot-repo": repoKey(repo),
  });

  const find = async (repo: Repo) => {
    const { workspaces } = await gitterm.workspaces.list({
      status: "active",
      metadata: tags(repo),
      limit: 1,
    });
    return workspaces[0] ?? null;
  };

  const create = async (repo: Repo) => {
    const connections = [...(await githubFor(gitterm, repo)), ...input.connections];
    const env = { ...input.overrides?.environmentVariables, ...input.env };
    const setup =
      input.overrides?.setup ?? (input.setup.length ? { beforeAgent: input.setup } : undefined);
    const models =
      input.overrides?.models ??
      (input.model ? modelsFor(input.model, await gitterm.credentials.list()) : undefined);
    log.info(`Creating a GitTerm sandbox for ${repoKey(repo)}`, {
      connections,
      model: input.model?.id ?? "dashboard defaults",
    });
    const name = repoLabel(repo).split("/").pop() ?? "repo";
    const { workspace } = await gitterm.workspaces.create({
      ...input.overrides,
      name: `${input.platform}-bot-${name}`,
      repo: repo.url,
      ...(repo.branch ? { branch: repo.branch } : {}),
      agent: "opencode",
      metadata: tags(repo),
      connections,
      ...(models ? { models } : {}),
      ...(Object.keys(env).length ? { environmentVariables: env } : {}),
      ...(setup ? { setup } : {}),
      additionalAgentInstructions: [
        input.instructions,
        input.overrides?.additionalAgentInstructions,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    return workspace;
  };

  return {
    find,
    async ensure(repo, progress) {
      let workspace = await find(repo);
      if (!workspace) {
        progress({
          message: `Creating a sandbox for ${repoLabel(repo)}. The first start takes a few minutes…`,
          indicator: `is creating a sandbox for ${repoLabel(repo)} (the first start takes a few minutes)…`,
        });
        workspace = await create(repo);
      } else if (workspace.status === "paused") {
        progress({ message: "Waking up the sandbox…", indicator: "is waking up the sandbox…" });
      }
      const running = await gitterm.workspaces.ensureRunning(workspace.id, {
        timeoutMs: RESUME_TIMEOUT_MS,
      });
      return running.workspace;
    },
    async reset(repo) {
      const workspace = await find(repo);
      if (!workspace) return false;
      await gitterm.workspaces.terminate(workspace.id);
      return true;
    },
  };
}
