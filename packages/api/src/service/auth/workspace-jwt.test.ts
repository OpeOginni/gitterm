import { describe, expect, test } from "bun:test";
import { WorkspaceJWTService, type WorkspaceTokenPayload } from "./workspace-jwt";

const payload = (scope: string[]): WorkspaceTokenPayload => ({
  workspaceId: "workspace",
  userId: "user",
  scope,
  iat: 0,
  exp: Number.MAX_SAFE_INTEGER,
});

describe("WorkspaceJWTService.hasScope", () => {
  test("matches only exact and same-namespace wildcard scopes", () => {
    expect(WorkspaceJWTService.hasScope(payload(["port:*"]), "port:open")).toBe(true);
    expect(WorkspaceJWTService.hasScope(payload(["port:*"]), "workspace:create")).toBe(false);
    expect(WorkspaceJWTService.hasScope(payload(["workspace:read"]), "workspace:read")).toBe(true);
  });

  test("supports an explicit global wildcard", () => {
    expect(WorkspaceJWTService.hasScope(payload(["*"]), "workspace:read")).toBe(true);
  });
});
