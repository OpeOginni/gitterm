import { describe, expect, test } from "bun:test";
import { buildWorkspaceEnv } from "./workspace-env";
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
