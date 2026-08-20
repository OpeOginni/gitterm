import { describe, expect, test } from "bun:test";
import { GittermError } from "./errors";
import { createGittermWorkspaceClient, getWorkspaceEnvironment } from "./workspace-client";

describe("getWorkspaceEnvironment", () => {
  test("returns null outside a workspace", () => {
    expect(getWorkspaceEnvironment({})).toBeNull();
  });

  test("requires the complete workspace identity", () => {
    expect(() => getWorkspaceEnvironment({ WORKSPACE_ID: "workspace" })).toThrow(GittermError);
  });

  test("returns only workspace-scoped credentials", () => {
    expect(
      getWorkspaceEnvironment({
        WORKSPACE_ID: "workspace",
        WORKSPACE_API_URL: "https://api.example.com",
        WORKSPACE_AUTH_TOKEN: "workspace-token",
        GITTERM_API_TOKEN: "account-token",
      }),
    ).toEqual({
      workspaceId: "workspace",
      serverUrl: "https://api.example.com",
      token: "workspace-token",
    });
  });

  test("complete explicit credentials ignore an incomplete environment", () => {
    const previous = process.env.WORKSPACE_ID;
    process.env.WORKSPACE_ID = "incomplete";
    try {
      const client = createGittermWorkspaceClient({
        workspaceId: "explicit",
        serverUrl: "https://api.example.com",
        token: "token",
      });
      expect(client.workspaceId).toBe("explicit");
    } finally {
      if (previous === undefined) delete process.env.WORKSPACE_ID;
      else process.env.WORKSPACE_ID = previous;
    }
  });
});
