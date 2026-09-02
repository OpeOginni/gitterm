import { describe, expect, test } from "bun:test";
import {
  buildDirectGittermInstructions,
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
      setup: { beforeAgent: ["bun install"], afterAgent: ["bun test"] },
      secretFiles: [{ path: "~/.secrets/token", content: "secret", mode: 0o400 }],
    });

    expect(plan.repository?.name).toBe("project");
    expect(plan.repository?.authUsername).toBe("oauth2");
    expect(plan.repository?.authToken).toBe("repo-token");
    expect(plan.agent.environmentVariables).toEqual({
      CUSTOM_VALUE: "custom",
      OPENCODE_SERVER_PASSWORD: "password",
    });
    expect(plan.agent.files).toHaveLength(4);
    expect(plan.agent.files.at(-1)).toMatchObject({ path: "~/.secrets/token", mode: 0o400 });
    expect(setupCommandScript(plan.setup.beforeAgent)).toContain("bun install");
    expect(plan.setup.afterAgent).toEqual(["bun test"]);
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
    expect(() =>
      buildDirectProvisioningPlan({
        id: "workspace-1",
        lifecycle: "ephemeral",
        password: "password",
        secretFiles: [{ path: "~/../token", content: "bad" }],
      }),
    ).toThrow("Invalid secret file path");
    expect(() =>
      buildDirectProvisioningPlan({
        id: "workspace-1",
        lifecycle: "ephemeral",
        password: "password",
        secretFiles: [{ path: "/run/token", content: "bad", mode: 0o1000 }],
      }),
    ).toThrow("Secret file mode");
  });

  test("appends additional agent instructions to the global AGENTS.md", () => {
    const plan = buildDirectProvisioningPlan({
      id: "workspace-1",
      lifecycle: "ephemeral",
      password: "password",
      additionalAgentInstructions: "You are operating as a Slack bot.\nUse concise replies.",
    });
    const instructions = plan.agent.files.find(
      (file) => file.path === "~/.config/opencode/AGENTS.md",
    );

    expect(Buffer.from(instructions!.contentBase64, "base64").toString()).toBe(
      buildDirectGittermInstructions("You are operating as a Slack bot.\nUse concise replies."),
    );
    expect(buildDirectGittermInstructions("  ")).toBe(
      "You are running in a direct Gitterm workspace. Follow the user's instructions and verify outcomes before reporting success.",
    );
    expect(() => buildDirectGittermInstructions("x".repeat(50_001))).toThrow(
      "additionalAgentInstructions is too large",
    );
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
