import { db, and, eq } from "@gitterm/db";
import { gitIntegration } from "@gitterm/db/schema/integrations";
import { getGitHubAppService, parseGitHubRepoUrl } from "./github";
import { githubGlobalPat } from "./github/config";
import { integrationPolicy } from "./integrations/catalog";

export async function issueWorkspaceGitCredential(ws: {
  id: string;
  userId: string;
  gitIntegrationId: string | null;
  useGlobalGithubPat?: boolean;
  repositoryUrl: string | null;
  status: "pending" | "running" | "paused" | "terminated";
}) {
  if (ws.status !== "running") throw new Error("Workspace is not running");
  const repo = ws.repositoryUrl ? parseGitHubRepoUrl(ws.repositoryUrl) : null;
  if (!repo || (!ws.gitIntegrationId && !ws.useGlobalGithubPat))
    throw new Error("Workspace has no refreshable GitHub integration");
  if (!(await integrationPolicy("github")).enabled)
    throw new Error("GitHub repository access is disabled");
  if (ws.useGlobalGithubPat) {
    const token = await githubGlobalPat();
    if (!token) throw new Error("Global GitHub PAT is no longer available");
    return { token, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  }
  if (!ws.gitIntegrationId) throw new Error("Workspace has no GitHub App integration");
  const integration = await db.query.gitIntegration.findFirst({
    where: and(
      eq(gitIntegration.id, ws.gitIntegrationId),
      eq(gitIntegration.userId, ws.userId),
      eq(gitIntegration.provider, "github"),
    ),
  });
  if (!integration) throw new Error("GitHub integration is no longer available");
  const github = await getGitHubAppService();
  const installation = await github.getUserInstallation(
    ws.userId,
    integration.providerInstallationId,
  );
  if (!installation) throw new Error("GitHub installation is no longer available");
  return github.getUserToServerToken(installation.installationId, [repo.repo]);
}
