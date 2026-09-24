import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { db } from "@gitterm/db";
import * as github from "./github";
import * as githubConfig from "./github/config";
import { issueWorkspaceGitCredential } from "./workspace-git-credential";

afterEach(() => mock.restore());
beforeEach(() => {
  spyOn(db, "select").mockImplementation((() => ({
    from: () => ({ where: async () => [{ enabled: true }] }),
  })) as any);
});
const ws = {
  id: "workspace",
  userId: "owner",
  gitIntegrationId: "integration",
  repositoryUrl: "https://github.com/team/project",
  status: "running" as const,
};

test("paused and terminated workspaces cannot mint credentials", async () => {
  await expect(issueWorkspaceGitCredential({ ...ws, status: "paused" })).rejects.toThrow(
    "not running",
  );
  await expect(issueWorkspaceGitCredential({ ...ws, status: "terminated" })).rejects.toThrow(
    "not running",
  );
});

test("refresh is scoped to the workspace's repository and installation", async () => {
  spyOn(db.query.gitIntegration, "findFirst").mockImplementation((async () => ({
    providerInstallationId: "installation",
  })) as any);
  const issue = mock(async () => ({ token: "token", expiresAt: "expiry" }));
  const installation = mock(async () => ({ installationId: "installation" }));
  spyOn(github, "getGitHubAppService").mockReturnValue({
    getUserInstallation: installation,
    getUserToServerToken: issue,
  } as any);
  expect(await issueWorkspaceGitCredential(ws)).toEqual({ token: "token", expiresAt: "expiry" });
  expect(installation).toHaveBeenCalledWith("owner", "installation");
  expect(issue).toHaveBeenCalledWith("installation", ["project"]);
});

test("revoked integrations and installations cannot mint credentials", async () => {
  const integration = spyOn(db.query.gitIntegration, "findFirst").mockImplementation(
    (async () => undefined) as any,
  );
  await expect(issueWorkspaceGitCredential(ws)).rejects.toThrow("no longer available");
  integration.mockImplementation((async () => ({ providerInstallationId: "installation" })) as any);
  const issue = mock(async () => ({ token: "token" }));
  spyOn(github, "getGitHubAppService").mockReturnValue({
    getUserInstallation: async () => null,
    getUserToServerToken: issue,
  } as any);
  await expect(issueWorkspaceGitCredential(ws)).rejects.toThrow("no longer available");
  expect(issue).not.toHaveBeenCalled();
});

test("caller-supplied tokens without a saved integration are not refreshed", async () => {
  await expect(issueWorkspaceGitCredential({ ...ws, gitIntegrationId: null })).rejects.toThrow(
    "no refreshable",
  );
});

test("a workspace explicitly selected global PAT is brokered only while running", async () => {
  const app = spyOn(github, "getGitHubAppService");
  spyOn(githubConfig, "githubGlobalPat").mockResolvedValue("secret");
  const patWorkspace = { ...ws, gitIntegrationId: null, sharedGitConnectionId: "github:shared" };
  const issued = await issueWorkspaceGitCredential(patWorkspace);
  expect(issued.token).toBe("secret");
  expect(Date.parse(issued.expiresAt)).toBeGreaterThan(Date.now() + 10 * 60_000);
  expect(githubConfig.githubGlobalPat).toHaveBeenCalled();
  expect(app).not.toHaveBeenCalled();
  await expect(issueWorkspaceGitCredential({ ...patWorkspace, status: "paused" })).rejects.toThrow(
    "not running",
  );
});

test("switching away from a global PAT blocks future credential issuance", async () => {
  spyOn(githubConfig, "githubGlobalPat").mockResolvedValue(null);
  await expect(
    issueWorkspaceGitCredential({
      ...ws,
      gitIntegrationId: null,
      sharedGitConnectionId: "github:shared",
    }),
  ).rejects.toThrow("no longer available");
});
