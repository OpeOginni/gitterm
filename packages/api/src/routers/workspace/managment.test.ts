import { describe, expect, test } from "bun:test";
import { resolveRepositoryProvisioningAuth, workspaceCreateSchema } from "./managment";

describe("managed repository credentials", () => {
  test("validates inline credentials and gives them precedence over integration auth", () => {
    const parsed = workspaceCreateSchema.parse({
      repo: "https://github.com/acme/private-repo",
      repositoryCredentials: { token: "github-pat" },
    });
    expect(
      resolveRepositoryProvisioningAuth(parsed.repositoryCredentials, {
        username: "dashboard-user",
        token: "app-token",
      }),
    ).toEqual({
      authUsername: "x-access-token",
      authToken: "github-pat",
      inlineAuth: true,
    });
    expect(() =>
      workspaceCreateSchema.parse({
        repo: "https://github.com/acme/private-repo",
        repositoryCredentials: { token: "" },
      }),
    ).toThrow();
  });
});
