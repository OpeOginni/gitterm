import { afterEach, expect, mock, test } from "bun:test";
import {
  issueWorkspaceModelToken,
  ModelCredentialUnavailableError,
  refreshModelOAuthCredential,
} from "./workspace-model-token";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const workspace = {
  id: "ws",
  userId: "user",
  status: "running" as const,
  modelCredentialIds: ["cred-1"],
};

test("workspaces only get tokens for their own credentials while running", async () => {
  await expect(issueWorkspaceModelToken(workspace, "cred-2")).rejects.toThrow(
    "not attached to this workspace",
  );
  await expect(
    issueWorkspaceModelToken({ ...workspace, status: "paused" }, "cred-1"),
  ).rejects.toBeInstanceOf(ModelCredentialUnavailableError);
});

test("OpenCode console refresh stores the rotated token and keeps the organization", async () => {
  globalThis.fetch = mock(async () =>
    Response.json({ access_token: "a2", refresh_token: "r2", expires_in: 3600, org_id: "org_1" }),
  ) as unknown as typeof fetch;
  const next = await refreshModelOAuthCredential("opencode-console", {
    type: "oauth",
    refresh: "r1",
    access: "a1",
    expires: 1,
    metadata: { server: "https://opencode.ai/console", orgID: "org_1", orgName: "Acme" },
  });
  expect(next).toMatchObject({
    refresh: "r2",
    access: "a2",
    metadata: { orgID: "org_1", orgName: "Acme" },
  });
  expect(next.expires).toBeGreaterThan(Date.now());
});

test("xAI refresh keeps the refresh token when none is returned", async () => {
  globalThis.fetch = mock(async () =>
    Response.json({ access_token: "a2", expires_in: 3600 }),
  ) as unknown as typeof fetch;
  const next = await refreshModelOAuthCredential("xai-oauth", { type: "oauth", refresh: "r1" });
  expect(next).toMatchObject({ refresh: "r1", access: "a2" });
});

test("providers GitTerm does not refresh are refused", async () => {
  await expect(
    refreshModelOAuthCredential("copilot-auth", { type: "oauth", refresh: "gho" }),
  ).rejects.toBeInstanceOf(ModelCredentialUnavailableError);
});
