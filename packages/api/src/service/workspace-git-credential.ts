import { db, and, eq } from "@gitterm/db";
import { gitIntegration } from "@gitterm/db/schema/integrations";
import { getGitHubAppService, parseGitHubRepoUrl } from "./github";

export async function issueWorkspaceGitCredential(ws: {
  userId: string;
  gitIntegrationId: string | null;
  repositoryUrl: string | null;
}) {
  const repo = ws.repositoryUrl ? parseGitHubRepoUrl(ws.repositoryUrl) : null;
  if (!repo || !ws.gitIntegrationId)
    throw new Error("Workspace has no refreshable GitHub integration");
  const integration = await db.query.gitIntegration.findFirst({
    where: and(
      eq(gitIntegration.id, ws.gitIntegrationId),
      eq(gitIntegration.userId, ws.userId),
      eq(gitIntegration.provider, "github"),
    ),
  });
  if (!integration) throw new Error("GitHub integration is no longer available");
  const github = getGitHubAppService();
  const installation = await github.getUserInstallation(
    ws.userId,
    integration.providerInstallationId,
  );
  if (!installation) throw new Error("GitHub installation is no longer available");
  return github.getUserToServerToken(installation.installationId, [repo.repo]);
}
