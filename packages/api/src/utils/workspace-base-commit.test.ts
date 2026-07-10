import { describe, expect, test } from "bun:test";
import { isFullGitSha, normalizeBaseCommit, tryNormalizeBaseCommit } from "./workspace-base-commit";

describe("normalizeBaseCommit", () => {
  test("accepts full 40-char SHA and lowercases it", () => {
    const sha = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
    expect(normalizeBaseCommit(sha)).toBe(sha.toLowerCase());
  });

  test("accepts full 64-char SHA", () => {
    const sha = "a".repeat(64);
    expect(normalizeBaseCommit(sha)).toBe(sha);
  });

  test("returns null for empty/undefined", () => {
    expect(normalizeBaseCommit(undefined)).toBeNull();
    expect(normalizeBaseCommit(null)).toBeNull();
    expect(normalizeBaseCommit("")).toBeNull();
    expect(normalizeBaseCommit("   ")).toBeNull();
  });

  test("rejects short SHAs and non-hex", () => {
    expect(() => normalizeBaseCommit("abc123")).toThrow(/full git SHA/);
    expect(() => normalizeBaseCommit("g".repeat(40))).toThrow(/full git SHA/);
  });

  test("isFullGitSha and tryNormalizeBaseCommit", () => {
    expect(isFullGitSha("a".repeat(40))).toBe(true);
    expect(isFullGitSha("abc")).toBe(false);
    expect(tryNormalizeBaseCommit("not-a-sha")).toBeNull();
    expect(tryNormalizeBaseCommit("b".repeat(40))).toBe("b".repeat(40));
  });
});
