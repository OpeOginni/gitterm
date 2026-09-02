import { afterEach, describe, expect, test } from "bun:test";
import { checkGitHubRepositoryWithToken, resolveGitHubBranchHeadWithToken } from ".";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("inline GitHub repository credentials", () => {
  test("authenticates repository, branch, and commit validation", async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json(
        request.url.includes("/branches/")
          ? { commit: { sha: "a".repeat(40) } }
          : request.url.includes("/commits/")
            ? { sha: "a".repeat(40) }
            : { default_branch: "main" },
      );
    }) as typeof fetch;

    const result = await checkGitHubRepositoryWithToken(
      "https://github.com/acme/private-repo",
      "github-pat",
      "main",
      "a".repeat(40),
    );

    expect(result).toEqual({
      valid: true,
      exists: true,
      canClone: true,
      branchExists: true,
      commitExists: true,
    });
    expect(requests).toHaveLength(3);
    expect(
      requests.every((request) => request.headers.get("authorization") === "token github-pat"),
    ).toBeTrue();
  });

  test("uses the credential when resolving a private branch head", async () => {
    const authorizations: Array<string | null> = [];
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      authorizations.push(request.headers.get("authorization"));
      return Response.json({ commit: { sha: "b".repeat(40) } });
    }) as typeof fetch;

    expect(
      await resolveGitHubBranchHeadWithToken(
        "https://github.com/acme/private-repo",
        "github-pat",
        "main",
      ),
    ).toBe("b".repeat(40));
    expect(authorizations).toEqual(["token github-pat"]);
  });
});
