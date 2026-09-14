import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { db } from "@gitterm/db";
import * as github from "./github";
import { issueWorkspaceGitCredential } from "./workspace-git-credential";

afterEach(() => mock.restore());
const ws = {
  userId: "owner",
  gitIntegrationId: "integration",
  repositoryUrl: "https://github.com/team/project",
};

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
