import { describe, expect, test } from "bun:test";
import { buildDirectProvisioningPlan, containerEnvironment } from "./provisioning";

describe("direct provisioning plan", () => {
  test("normalizes one plan for native and container providers", () => {
    const plan = buildDirectProvisioningPlan({
      id: "workspace-1",
      lifecycle: "persistent",
      password: "password",
      repo: "https://github.com/acme/project.git",
      branch: "main",
      repositoryCredentials: { token: "github-token" },
      modelCredentials: [{ providerName: "anthropic", apiKey: "model-key" }],
      setupCommands: ["bun install"],
    });

    expect(plan.repository?.name).toBe("project");
    expect(plan.repository?.authToken).toBe("github-token");
    expect(plan.agent.files).toHaveLength(3);
    expect(containerEnvironment(plan)).toMatchObject({
      REPO_URL: "https://github.com/acme/project.git",
      REPO_NAME: "project",
      GITHUB_APP_TOKEN: "github-token",
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
  });
});
