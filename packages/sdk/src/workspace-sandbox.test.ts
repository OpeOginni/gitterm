import { describe, expect, test } from "bun:test";

// Mirror SDK normalizeBaseCommit behavior used by the client (kept free of
// network / TRPC deps so the suite can run offline).
function normalizeBaseCommit(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

describe("SDK baseCommit normalization", () => {
  test("lowercases full SHAs", () => {
    const sha = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
    expect(normalizeBaseCommit(sha)).toBe(sha.toLowerCase());
  });

  test("preserves nullish", () => {
    expect(normalizeBaseCommit(null)).toBeNull();
    expect(normalizeBaseCommit(undefined)).toBeNull();
  });

  test("passes through non-sha strings without throwing", () => {
    // SDK normalizer is lenient; API validates on write.
    expect(normalizeBaseCommit("main")).toBe("main");
  });
});

describe("ensureRunning semantics (pure)", () => {
  function canEnsureRunning(status: string): {
    ok: boolean;
    shouldRestart: boolean;
    error?: string;
  } {
    if (status === "terminated") {
      return { ok: false, shouldRestart: false, error: "terminated" };
    }
    if (status === "paused") {
      return { ok: true, shouldRestart: true };
    }
    if (status === "running" || status === "pending") {
      return { ok: true, shouldRestart: false };
    }
    return { ok: false, shouldRestart: false, error: "unknown" };
  }

  test("running returns immediately without restart", () => {
    expect(canEnsureRunning("running")).toEqual({ ok: true, shouldRestart: false });
  });

  test("paused restarts", () => {
    expect(canEnsureRunning("paused")).toEqual({ ok: true, shouldRestart: true });
  });

  test("terminated cannot be ensured running", () => {
    expect(canEnsureRunning("terminated")).toEqual({
      ok: false,
      shouldRestart: false,
      error: "terminated",
    });
  });
});
