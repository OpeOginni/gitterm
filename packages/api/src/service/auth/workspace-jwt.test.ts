import { describe, expect, test } from "bun:test";
import { WorkspaceJWTService, type WorkspaceTokenPayload } from "./workspace-jwt";

const payload = (scope: string[]): WorkspaceTokenPayload => ({
  workspaceId: "workspace",
  userId: "user",
  scope,
  purpose: "workspace",
  iss: "gitterm",
  aud: "gitterm-workspace-api",
  jti: "token-id",
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
    const token = WorkspaceJWTService.generateToken(
      "workspace",
      "user",
      ["workspace:read", "port:*"],
      "workspace",
    );
    const decoded = WorkspaceJWTService.verifyToken(token, "workspace");
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
    expect(decoded.jti).toBeTruthy();
    expect(decoded.iss).toBe("gitterm");
    expect(decoded.aud).toBe("gitterm-workspace-api");
    expect(() => WorkspaceJWTService.verifyToken(token, "agent")).toThrow();
    expect(WorkspaceJWTService.hasScope(decoded, "port:open")).toBe(true);
    expect(WorkspaceJWTService.hasScope(decoded, "git:refresh")).toBe(false);
    expect(WorkspaceJWTService.hasScope(decoded, "setup:write")).toBe(false);
  });
});
