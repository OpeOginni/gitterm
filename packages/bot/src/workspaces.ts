import type { Connection, GittermClient, Workspace } from "@gitterm/sdk";
import type { StatusText } from "./status.js";
import type { BotLogger, RepoTarget, WorkspaceOverrides } from "./types.js";

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

function githubOwner(url: string): string | undefined {
  return /^(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\//i.exec(url)?.[1]?.toLowerCase();
}

/**
 * The bot's opinion of what a sandbox needs: GitHub access for the repository's owner (or the
 * deployment's shared GitHub connection) and every connected MCP/Executor tool source.
 */
export function pickConnections(
  available: Connection[],
  repo: Repo,
  choice: "auto" | string[],
): string[] {
  const connected = available.filter((connection) => connection.status === "connected");
  if (choice !== "auto") {
    return choice.map((reference) => {
      const match =
        connected.find((connection) => connection.id === reference) ??
        connected.find((connection) => connection.name.toLowerCase() === reference.toLowerCase());
      if (!match) {
        throw new Error(
          `GitTerm connection "${reference}" is not connected. Check its id or name under Dashboard → Integrations.`,
        );
      }
      return match.id;
    });
  }

  const picked: string[] = [];
  const owner = githubOwner(repo.url);
  if (owner) {
    const github = connected.filter((connection) => connection.integration === "github");
    const match =
      github.find(
        (connection) =>
          connection.details.integration === "github" &&
          connection.details.accountLogin.toLowerCase() === owner,
      ) ?? github.find((connection) => connection.kind === "shared");
    if (match) picked.push(match.id);
  }
  for (const connection of connected) {
    if (connection.integration === "mcp" || connection.integration === "executor") {
      picked.push(connection.id);
    }
  }
  return picked;
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
  connections: "auto" | string[];
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
    const connections = pickConnections(
      await gitterm.integrations.connections.list(),
      repo,
      input.connections,
    );
    log.info(`Creating a GitTerm sandbox for ${repoKey(repo)}`, { connections });
    const name = repoLabel(repo).split("/").pop() ?? "repo";
    const { workspace } = await gitterm.workspaces.create({
      ...input.overrides,
      name: `${input.platform}-bot-${name}`,
      repo: repo.url,
      ...(repo.branch ? { branch: repo.branch } : {}),
      agent: "opencode",
      metadata: tags(repo),
      connections,
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
