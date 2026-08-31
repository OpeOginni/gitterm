import { describe, expect, test } from "bun:test";
import {
  buildDirectProvisioningPlan,
  DIRECT_OPENCODE_SERVER_IMAGE,
  cloneRepositoryScript,
  railwayContainerEnvironment,
  resolveDirectImage,
  setupCommandScript,
} from "./provisioning";

describe("direct provisioning plan", () => {
  test("normalizes one plan for native and container providers", () => {
    const plan = buildDirectProvisioningPlan({
      id: "workspace-1",
      lifecycle: "persistent",
      password: "password",
      repo: "https://gitlab.com/acme/project.git",
      branch: "main",
      repositoryCredentials: { username: "oauth2", token: "repo-token" },
      environmentVariables: {
        OPENCODE_SERVER_USERNAME: "admin",
        GITTERM_DIRECT_PROVIDER: "daytona",
        CUSTOM_VALUE: "custom",
      },
      modelCredentials: [{ providerName: "anthropic", apiKey: "model-key" }],
      setupCommands: ["bun install"],
    });

    expect(plan.repository?.name).toBe("project");
    expect(plan.repository?.authUsername).toBe("oauth2");
    expect(plan.repository?.authToken).toBe("repo-token");
    expect(plan.agent.environmentVariables).toEqual({
      CUSTOM_VALUE: "custom",
      OPENCODE_SERVER_PASSWORD: "password",
    });
    expect(plan.agent.files).toHaveLength(3);
    expect(setupCommandScript(plan.setupCommands)).toContain("bun install");
    expect(railwayContainerEnvironment(plan)).toMatchObject({
      REPO_URL: "https://gitlab.com/acme/project.git",
      REPO_NAME: "project",
      GITTERM_GIT_USERNAME: "oauth2",
      GITTERM_GIT_TOKEN: "repo-token",
      GITTERM_DIRECT_PROVIDER: "railway",
      OPENCODE_SERVER_PASSWORD: "password",
    });
  });

  test("rejects path traversal and duplicate credentials", () => {
    expect(() =>
      buildDirectProvisioningPlan({
        id: "workspace-1",
        lifecycle: "ephemeral",
        password: "password",
        opencode: { skills: [{ name: "../escape", content: "bad" }] },
      }),
    ).toThrow("Invalid skill name");
    expect(() =>
      buildDirectProvisioningPlan({
        id: "workspace-1",
        lifecycle: "ephemeral",
        password: "password",
        modelCredentials: [
          { providerName: "anthropic", apiKey: "one" },
          { providerName: "anthropic", apiKey: "two" },
        ],
      }),
    ).toThrow("Duplicate model credential");
    expect(() =>
      buildDirectProvisioningPlan({
        id: "workspace-1",
        lifecycle: "ephemeral",
        password: "password",
        branch: "main",
        repositoryCredentials: { token: "repo-token" },
      }),
    ).toThrow("require repo");
    expect(resolveDirectImage(undefined)).toBe(DIRECT_OPENCODE_SERVER_IMAGE);
    expect(resolveDirectImage("  ")).toBe(DIRECT_OPENCODE_SERVER_IMAGE);
    expect(resolveDirectImage("my-registry/opencode:1.2.3")).toBe("my-registry/opencode:1.2.3");
    expect(
      cloneRepositoryScript(
        {
          url: "https://github.com/acme/project.git",
          name: "project",
          authToken: "repo-token",
        },
        "/workspace/project",
      ),
    ).toContain("rm -rf /tmp/gitterm");
  });

  test("writes portable OAuth credentials into OpenCode auth", () => {
    const plan = buildDirectProvisioningPlan({
      id: "workspace-1",
      lifecycle: "ephemeral",
      password: "password",
      modelCredentials: [
        {
          type: "oauth",
          providerName: "openai",
          refreshToken: "refresh-token",
          accessToken: "access-token",
          expiresAt: 123_000,
          accountId: "account-1",
        },
      ],
    });
    const auth = JSON.parse(Buffer.from(plan.agent.files[0]!.contentBase64, "base64").toString());

    expect(auth.openai).toEqual({
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: 123_000,
      accountId: "account-1",
    });
  });
});
