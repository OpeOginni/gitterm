import { describe, expect, test } from "bun:test";

describe("Vercel environment", () => {
  test("does not send container provisioning manifests to Sandbox.create", async () => {
    const { VercelProvider } = await import(".");
    const environment = (new VercelProvider() as any).getEnvironment(
      {
        environmentVariables: {
          AGENT_FILES_BASE64: "large-manifest",
          WORKSPACE_TOOLING_MANIFEST_BASE64: "large-tooling-manifest",
          WORKSPACE_API_URL: "https://api.example.com",
          CUSTOM_VALUE: "preserved",
        },
      },
      { agent: { env: { OPENCODE_SERVER_PASSWORD: "password" } } },
    );

    expect(environment).toEqual({
      WORKSPACE_API_URL: "https://api.example.com",
      CUSTOM_VALUE: "preserved",
      OPENCODE_SERVER_PASSWORD: "password",
    });
  });
});
