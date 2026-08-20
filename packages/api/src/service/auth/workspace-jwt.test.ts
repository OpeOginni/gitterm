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

  test("durable workspace tokens contain only their explicit scopes", () => {
    const token = WorkspaceJWTService.generateToken("workspace", "user", [
      "workspace:read",
      "port:*",
    ]);
    const decoded = WorkspaceJWTService.verifyToken(token);
    expect(decoded.exp).toBeUndefined();
    expect(WorkspaceJWTService.hasScope(decoded, "port:open")).toBe(true);
    expect(WorkspaceJWTService.hasScope(decoded, "git:refresh")).toBe(false);
    expect(WorkspaceJWTService.hasScope(decoded, "setup:write")).toBe(false);
  });
});
