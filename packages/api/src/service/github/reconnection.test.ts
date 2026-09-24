import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { db } from "@gitterm/db";
import { GitHubAppService } from ".";

afterEach(() => mock.restore());

test("an existing GitHub installation refreshes its connection time on callback", async () => {
  let integrationUpdate: { connectedAt?: Date } | undefined;
  spyOn(db, "select").mockImplementation((() => ({
    from: () => ({ where: async () => [{ id: "installation-row" }] }),
  })) as any);
  spyOn(db, "update").mockImplementation((() => ({
    set: (values: { connectedAt?: Date }) => {
      if (values.connectedAt) integrationUpdate = values;
      return { where: () => ({ returning: async () => [{ id: "installation-row" }] }) };
    },
  })) as any);

  // This path only reads/writes existing rows; no GitHub API client is needed.
  const github = Object.create(GitHubAppService.prototype) as GitHubAppService;
  const started = Date.now();
  await github.storeInstallation({
    userId: "user",
    installationId: "123",
    accountId: "456",
    accountLogin: "acme",
    accountType: "Organization",
    repositorySelection: "selected",
  });

  expect(integrationUpdate?.connectedAt).toBeInstanceOf(Date);
  expect(integrationUpdate!.connectedAt!.getTime()).toBeGreaterThanOrEqual(started);
});
