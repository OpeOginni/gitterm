import { describe, expect, test } from "bun:test";
import { ANON_WORKSPACE_TTL_SECONDS, isAnonWorkspaceExpired } from "./anon-lifetime";

describe("isAnonWorkspaceExpired", () => {
  const startedAt = new Date("2026-08-06T12:00:00.000Z");

  test("expires anonymous workspaces at exactly ten minutes", () => {
    const expiresAt = startedAt.getTime() + ANON_WORKSPACE_TTL_SECONDS * 1_000;

    expect(isAnonWorkspaceExpired("anon-test@anon.gitterm.local", startedAt, expiresAt - 1)).toBe(
      false,
    );
    expect(isAnonWorkspaceExpired("anon-test@anon.gitterm.local", startedAt, expiresAt)).toBe(true);
  });

  test("does not apply the anonymous lease to regular users", () => {
    expect(
      isAnonWorkspaceExpired("user@example.com", startedAt, startedAt.getTime() + 60 * 60 * 1_000),
    ).toBe(false);
  });
});
