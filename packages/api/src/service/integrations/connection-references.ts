/**
 * How workspace creation finds a connection from what a person can actually remember. A
 * reference is, in order:
 *
 * 1. a connection id (row UUID or `<integration>:shared`), exactly as before;
 * 2. an integration key (`github`, `google`, `mcp`, `executor`): the one connection of that
 *    kind. For `github` it is the connection that covers the repository's owner, falling back
 *    to the deployment's shared PAT, so `connections: ["github"]` "just works" for any repo;
 * 3. a connection name, case-insensitive.
 *
 * Names are not unique, so an ambiguous key or name is an error that lists the candidates
 * instead of a silent guess.
 */
import { TRPCError } from "@trpc/server";
import { INTEGRATIONS, type IntegrationKey } from "./catalog";
import type { Connection } from "./connections";

function githubOwner(repo: string | undefined): string | undefined {
  if (!repo) return undefined;
  return /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)([^/]+)\//i
    .exec(repo.trim())?.[1]
    ?.toLowerCase();
}

const describe = (connections: Connection[]) =>
  connections.map((connection) => `"${connection.name}" (${connection.id})`).join(", ");

const isIntegrationKey = (reference: string): reference is IntegrationKey =>
  Object.hasOwn(INTEGRATIONS, reference);

function byIntegration(
  key: IntegrationKey,
  available: Connection[],
  repo: string | undefined,
): Connection {
  const name = key === "mcp" ? "MCP server" : INTEGRATIONS[key].name;
  const candidates = available.filter(
    (connection) => connection.integration === key && connection.status === "connected",
  );
  if (key === "github") {
    const owner = githubOwner(repo);
    const match =
      (owner &&
        candidates.find(
          (connection) =>
            connection.kind === "personal" &&
            connection.details.integration === "github" &&
            connection.details.accountLogin.toLowerCase() === owner,
        )) ||
      candidates.find((connection) => connection.kind === "shared") ||
      (!owner && candidates.length === 1 ? candidates[0] : undefined);
    if (match) return match;
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: candidates.length
        ? `None of your GitHub connections covers ${owner ?? "this repository"}. Install the GitTerm GitHub App on ${owner ?? "its owner"} under Integrations.`
        : "Connect GitHub under Integrations first.",
    });
  }
  if (candidates.length === 1) return candidates[0]!;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: candidates.length
      ? `You have several ${name} connections: ${describe(candidates)}. Reference one by name or id.`
      : `You have no connected ${name} connection. Add one under Integrations.`,
  });
}

/** The connection a non-id reference points at. Ids are resolved by the caller. */
export function matchConnectionReference(
  reference: string,
  available: Connection[],
  repo: string | undefined,
): Connection {
  const wanted = reference.trim();
  if (isIntegrationKey(wanted.toLowerCase())) {
    return byIntegration(wanted.toLowerCase() as IntegrationKey, available, repo);
  }
  const named = available.filter(
    (connection) => connection.name.toLowerCase() === wanted.toLowerCase(),
  );
  if (named.length === 1) return named[0]!;
  if (named.length > 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Several connections are named "${wanted}": ${describe(named)}. Reference one by id or rename it.`,
    });
  }
  throw new TRPCError({
    code: "NOT_FOUND",
    message: available.length
      ? `No connection is named "${wanted}". Your connections: ${describe(available)}.`
      : `No connection is named "${wanted}", and you have no connections yet. Add them under Integrations.`,
  });
}
