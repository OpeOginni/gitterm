import { describe, expect, test } from "bun:test";
import { buildWorkspaceEnv, buildWorkspaceProvisioningSpec } from "./workspace-env";
import { railwayBootstrapEnvironment } from "./workspace-runtime-bundle";
import type { WorkspaceProvisioningSpec } from "../providers/compute";

const spec: WorkspaceProvisioningSpec = {
  agent: { files: [], env: {}, usesServerPassword: true },
  repo: {
    url: "https://github.com/acme/private-repo",
    authUsername: "x-access-token",
    authToken: "inline-pat",
    inlineAuth: true,
  },
  workspaceProfile: "standard",
  editorAccessEnabled: false,
};

function runtime(provider: string) {
  return {
    toolingManifestBase64: "manifest",
    workspaceId: "workspace-id",
    workspaceAuthToken: "workspace-auth",
    workspaceAgentAuthToken: "agent-auth",
    workspaceSetupAuthToken: "setup-auth",
    workspaceApiUrl: "https://api.example.com",
    workspaceProvider: provider,
  };
}

describe("managed clone credentials", () => {
  test.each([true, false])(
    "provisions shared runtime credentials (inline=%s) before user setup",
    (inlineAuth) => {
      const provision = buildWorkspaceProvisioningSpec({
        ...spec,
        agent: { ...spec.agent, serve: { command: "opencode serve", port: 4096 } },
        repo: { ...spec.repo!, inlineAuth, authExpiresAt: "2026-09-09T00:00:00Z" },
        beforeAgentCommand: "gh pr list",
      });
      const file = provision.agent.files.find((entry) =>
        entry.path.endsWith("github/config.json"),
      )!;
      const credential = JSON.parse(Buffer.from(file.contentBase64, "base64").toString());
      expect(credential.renewable).toBe(!inlineAuth);
      expect(credential.expiresAt).toBe("2026-09-09T00:00:00Z");
      expect(provision.beforeAgentCommand).toEndWith("gh pr list");
      expect(provision.beforeAgentCommand).not.toContain("inline-pat");
      expect(provision.agent.serve?.command).toContain(".gitterm/bin");
      expect(spec.agent.files).toEqual([]);
    },
  );
  test.each(["railway", "aws"])("passes inline auth to %s entrypoints", (provider) => {
    const env = buildWorkspaceEnv(spec, runtime(provider));
    expect(env.GITTERM_REPOSITORY_USERNAME).toBe("x-access-token");
    expect(env.GITTERM_REPOSITORY_TOKEN).toBe("inline-pat");
    expect(env.GITHUB_APP_TOKEN).toBeUndefined();
  });

  test.each(["e2b", "daytona", "vercel", "ascii", "exedev", "cloudflare"])(
    "does not expose inline auth in the %s runtime environment",
    (provider) => {
      const env = buildWorkspaceEnv(spec, runtime(provider));
      expect(JSON.stringify(env)).not.toContain("inline-pat");
    },
  );
});

test("Google integration identity variables cannot be overridden by user env", () => {
  const env = buildWorkspaceEnv(spec, {
    ...runtime("railway"),
    googleApplicationCredentials: "/run/gitterm/google/adc.json",
    googleProjectId: "trusted-project",
    userEnv: {
      GOOGLE_APPLICATION_CREDENTIALS: "/workspace/stolen.json",
      GOOGLE_CLOUD_PROJECT: "other-project",
    },
  });
  expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe("/run/gitterm/google/adc.json");
  expect(env.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE).toBe("/run/gitterm/google/adc.json");
  expect(env.GOOGLE_CLOUD_PROJECT).toBe("trusted-project");
  expect(env.CLOUDSDK_CORE_PROJECT).toBe("trusted-project");
});

test("Railway receives only a revocable bootstrap capability", () => {
  const full = buildWorkspaceEnv(spec, {
    ...runtime("railway"),
    userEnv: { DATABASE_URL: "postgres://secret" },
  });
  const bootstrap = railwayBootstrapEnvironment(full);
  expect(bootstrap).toEqual({
    GITTERM_REMOTE_BOOTSTRAP: "1",
    WORKSPACE_ID: "workspace-id",
    WORKSPACE_API_URL: "https://api.example.com",
    WORKSPACE_AGENT_AUTH_TOKEN: "agent-auth",
    WORKSPACE_PROVIDER: "railway",
  });
  expect(JSON.stringify(bootstrap)).not.toContain("postgres://secret");
  expect(JSON.stringify(bootstrap)).not.toContain("inline-pat");
});
