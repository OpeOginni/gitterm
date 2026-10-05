import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Octokit } from "@octokit/rest";
import { db } from "@gitterm/db";
import { GitHubAppService } from ".";
import * as github from ".";
import * as config from "./config";
import { getWorkspaceCommitIdentity } from "./commit-identity";

const originalFetch = globalThis.fetch;
afterEach(() => {
  mock.restore();
  globalThis.fetch = originalFetch;
});

const currentUser = {
  id: "application-user",
  name: "A display name, not a login",
  email: "verified@example.com",
  emailVerified: true,
  showGitTermOnCommits: true,
};

function mockAccount(account: { accountId: string; accessToken: string | null } | undefined) {
  spyOn(db.query.account, "findFirst").mockResolvedValue(account as any);
}

function app(id: string) {
  // The app's own client is authenticated in production; tests stub its fetch instead.
  return Object.assign(Object.create(GitHubAppService.prototype), {
    appId: id,
    appOctokit: new Octokit(),
  }) as GitHubAppService;
}
const isAppRequest = (url: string) => new URL(url).pathname === "/app";

describe("workspace commit identities", () => {
  test("credits the OAuth-linked user with the actual ID/login and private noreply email", async () => {
    mockAccount({ accountId: "123", accessToken: "oauth-token" });
    spyOn(config, "githubRepositoryMode").mockResolvedValue(null);
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://api.github.com/user/123");
      expect(request.headers.get("authorization")).toBe("token oauth-token");
      return Response.json({ id: 123, login: "actual-login", name: "Actual Name" });
    }) as typeof fetch;
    const result = await getWorkspaceCommitIdentity(currentUser);
    expect(result.githubLogin).toBe("actual-login");
    expect(result.identity.author).toEqual({
      name: "Actual Name",
      email: "123+actual-login@users.noreply.github.com",
    });
    expect(result.identity.committer.name).toBe("GitTerm");
  });

  test("a failed GitHub lookup never falls back to the sign-in email", async () => {
    mockAccount({ accountId: "123", accessToken: "expired-token" });
    spyOn(config, "githubRepositoryMode").mockResolvedValue(null);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({ message: "Bad credentials" }, { status: 401 });
    }) as unknown as typeof fetch;
    const result = await getWorkspaceCommitIdentity(currentUser);
    // A GitHub sign-in's app email is their (possibly private) primary GitHub address.
    expect(result.identity.author.email).toBe("application-user@users.noreply.gitterm.invalid");
    expect(calls).toBe(1);
  });

  test("rejects mismatched account IDs instead of crediting another user", async () => {
    mockAccount({ accountId: "123", accessToken: "oauth-token" });
    spyOn(config, "githubRepositoryMode").mockResolvedValue(null);
    globalThis.fetch = (async () =>
      Response.json({ id: 456, login: "somebody-else" })) as unknown as typeof fetch;
    const result = await getWorkspaceCommitIdentity(currentUser);
    expect(result.githubLogin).toBeUndefined();
    expect(result.identity.author.email).toBe("application-user@users.noreply.gitterm.invalid");
  });

  test("does not associate unverified application emails with a GitHub account", async () => {
    mockAccount(undefined);
    spyOn(config, "githubRepositoryMode").mockResolvedValue(null);
    const result = await getWorkspaceCommitIdentity({ ...currentUser, emailVerified: false });
    expect(result.identity.author.email).toBe("application-user@users.noreply.gitterm.invalid");
    expect(result.githubLogin).toBeUndefined();
  });

  test("opting out makes the user both author and committer and skips app lookup", async () => {
    mockAccount(undefined);
    const mode = spyOn(config, "githubRepositoryMode");
    const result = await getWorkspaceCommitIdentity({
      ...currentUser,
      showGitTermOnCommits: false,
    });
    expect(result.identity.committer).toEqual(result.identity.author);
    expect(mode).not.toHaveBeenCalled();
  });

  test("uses the configured GitHub App's bot for branded commits", async () => {
    mockAccount(undefined);
    spyOn(config, "githubRepositoryMode").mockResolvedValue({
      mode: "app",
      appId: "2422092",
      slug: "gitterm-dev",
      source: "database",
    });
    const bot = {
      name: "gitterm-dev[bot]",
      email: "248179953+gitterm-dev[bot]@users.noreply.github.com",
    };
    spyOn(github, "getGitHubAppService").mockResolvedValue({
      getCommitIdentity: async () => bot,
    } as GitHubAppService);
    const result = await getWorkspaceCommitIdentity(currentUser);
    expect(result.identity.committer).toEqual(bot);
    expect(result.identity.author.email).toBe(currentUser.email);
  });

  test("app lookup failures do not block workspaces and retain transparent GitTerm attribution", async () => {
    mockAccount(undefined);
    spyOn(config, "githubRepositoryMode").mockRejectedValue(new Error("Unavailable"));
    const result = await getWorkspaceCommitIdentity(currentUser);
    expect(result.identity.committer).toEqual({ name: "GitTerm", email: "noreply@gitterm.dev" });
  });
});

describe("GitHub App bot metadata", () => {
  test("finds the bot user ID once, even for concurrent requests", async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.url);
      return Response.json(
        isAppRequest(request.url)
          ? { id: 2422092, slug: "gitterm-dev" }
          : { id: 248179953, login: "gitterm-dev[bot]", type: "Bot" },
      );
    }) as typeof fetch;
    const results = await Promise.all([
      app("2422092").getCommitIdentity(),
      app("2422092").getCommitIdentity(),
    ]);
    expect(results[0]).toEqual({
      name: "gitterm-dev[bot]",
      email: "248179953+gitterm-dev[bot]@users.noreply.github.com",
    });
    expect(results[1]).toEqual(results[0]);
    expect(requests).toHaveLength(2);
  });

  test("retries after a failure instead of caching it", async () => {
    const service = app("101");
    globalThis.fetch = (async () =>
      Response.json({ message: "Unavailable" }, { status: 503 })) as unknown as typeof fetch;
    await expect(service.getCommitIdentity()).rejects.toThrow();
    globalThis.fetch = (async (input, init) =>
      Response.json(
        isAppRequest(new Request(input, init).url)
          ? { id: 101, slug: "test-app" }
          : { id: 555, login: "test-app[bot]", type: "Bot" },
      )) as typeof fetch;
    expect((await service.getCommitIdentity()).email).toBe(
      "555+test-app[bot]@users.noreply.github.com",
    );
  });

  test("rejects a normal user pretending to be an app bot", async () => {
    globalThis.fetch = (async (input, init) =>
      Response.json(
        isAppRequest(new Request(input, init).url)
          ? { id: 102, slug: "test-app" }
          : { id: 555, login: "test-app[bot]", type: "User" },
      )) as typeof fetch;
    await expect(app("102").getCommitIdentity()).rejects.toThrow(
      "GitHub App bot identity mismatch",
    );
  });
});
