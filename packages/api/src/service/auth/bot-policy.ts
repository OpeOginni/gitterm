import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { workspaceModelsSchema } from "@gitterm/schema/workspace-models";
import type { bot } from "@gitterm/db/schema/bot";

export type BotIdentity = typeof bot.$inferSelect;
const publicReads = new Set([
  "bots.self",
  "bots.acquireLease",
  "bots.releaseLease",
  "agent.me",
  "workspace.getWorkspaceCatalog",
  "workspace.listAgentTypes",
  "workspace.listCloudProviders",
  "integrations.catalog",
  "integrations.list",
  "modelCredentials.listMyCredentials",
  "integrations.connections.list",
]);
const workspaceRoutes = new Set([
  "workspace.getWorkspace",
  "workspace.ensureRunning",
  "workspace.pauseWorkspace",
  "workspace.restartWorkspace",
  "workspace.deleteWorkspace",
  "workspace.getSetupStatus",
  "workspace.getModelAccess",
  "workspace.getRuntimeAccess",
  "workspace.listCredentialAudit",
  "run.create",
  "run.list",
  "run.get",
  "run.messages",
  "run.respond",
  "run.cancel",
  "run.lifecycle",
]);
const deny = (message = "This operation is outside the bot's saved policy"): never => {
  throw new TRPCError({ code: "FORBIDDEN", message });
};
export function botRepo(identity: BotIdentity) {
  const [url, branch] = identity.repo.split("#", 2);
  return { url, branch: branch || undefined };
}
export const botConnections = (identity: BotIdentity) => [
  ...identity.connections,
  ...(identity.githubAccess === "connection" ? ["github"] : []),
];

/** Fail closed: adding a new account endpoint does not grant delegated tokens access to it. */
export function checkBotRequest(
  identity: BotIdentity,
  path: string,
  raw: unknown,
): string | undefined {
  if (publicReads.has(path) || path === "workspace.listWorkspaces") return;
  if (workspaceRoutes.has(path)) {
    const result = z.object({ workspaceId: z.uuid(), model: z.string().optional() }).safeParse(raw);
    if (!result.success) return deny();
    const input = result.data;
    if (path === "run.create" && input.model && input.model !== identity.model) deny();
    return input.workspaceId;
  }
  if (path === "integrations.connections.resolve") {
    const result = z
      .object({ repo: z.string(), references: z.array(z.string()).max(32) })
      .safeParse(raw);
    if (!result.success) return deny();
    const input = result.data;
    if (input.repo !== botRepo(identity).url) deny();
    if (
      !Array.isArray(input.references) ||
      input.references.some((ref: string) => !botConnections(identity).includes(ref))
    )
      deny();
    return;
  }
  if (path !== "workspace.createWorkspace") deny();
  const result = z
    .object({
      repo: z.string(),
      branch: z.string().optional(),
      agent: z.string().optional(),
      agentTypeId: z.string().optional(),
      provider: z.object({ type: z.string() }).passthrough().optional(),
      connections: z.array(z.string()).max(32),
      models: workspaceModelsSchema,
      repositoryCredentials: z.unknown().optional(),
    })
    .passthrough()
    .safeParse(raw);
  if (!result.success) return deny();
  const input = result.data;
  const repo = botRepo(identity);
  if (
    input.repo !== repo.url ||
    input.branch !== repo.branch ||
    input.agentTypeId ||
    (input.agent && input.agent !== "opencode")
  )
    deny();
  if (identity.provider && input.provider?.type !== identity.provider) deny();
  // AWS access profiles are the owner's roles; a bot never picks one.
  if (input.provider && "accessProfile" in input.provider) deny();
  if (
    !Array.isArray(input.connections) ||
    input.connections.some((ref: string) => !botConnections(identity).includes(ref))
  )
    deny();
  if (identity.githubAccess !== "token" && input.repositoryCredentials) deny();
  const models = input.models;
  const provider = identity.model.split("/")[0]!;
  if (!models || models.default !== identity.model || (models.inherit && models.inherit !== "none"))
    deny();
  for (const [key, source] of Object.entries(models.providers ?? {})) {
    if (key !== provider) deny();
    if (source.source === "saved" && source.label !== identity.credential) deny();
    if (source.source === "default" && identity.credential) deny();
  }
  // A saved credential must be asked for by name, not left to the provider default.
  if (identity.credential && models.providers?.[provider]?.source !== "saved") deny();
}
