import { describe, expect, test } from "bun:test";
import { isEmailAuthEnabled, isGitHubAuthEnabled, webEnvSchema } from "./web";

describe("web authentication configuration", () => {
  test("missing public deployment mode defaults to email-only self-hosted login", () => {
    const config = webEnvSchema.parse({});
    expect(isEmailAuthEnabled(config)).toBe(true);
    expect(isGitHubAuthEnabled(config)).toBe(false);
  });

  test("managed web mode defaults to GitHub rather than email", () => {
    const config = webEnvSchema.parse({ NEXT_PUBLIC_DEPLOYMENT_MODE: "managed" });
    expect(isEmailAuthEnabled(config)).toBe(false);
    expect(isGitHubAuthEnabled(config)).toBe(true);
  });

  test("managed deployments honor explicit authentication flags", () => {
    const config = webEnvSchema.parse({
      NEXT_PUBLIC_DEPLOYMENT_MODE: "managed",
      NEXT_PUBLIC_ENABLE_EMAIL_AUTH: "true",
      NEXT_PUBLIC_ENABLE_GITHUB_AUTH: "false",
    });
    expect(isEmailAuthEnabled(config)).toBe(true);
    expect(isGitHubAuthEnabled(config)).toBe(false);
  });

  test("self-hosted mode remains email-only regardless of GitHub flags", () => {
    const config = webEnvSchema.parse({
      NEXT_PUBLIC_DEPLOYMENT_MODE: "self-hosted",
      NEXT_PUBLIC_ENABLE_EMAIL_AUTH: "false",
      NEXT_PUBLIC_ENABLE_GITHUB_AUTH: "true",
    });
    expect(isEmailAuthEnabled(config)).toBe(true);
    expect(isGitHubAuthEnabled(config)).toBe(false);
  });
});
