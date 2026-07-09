/**
 * Helpers for exact git base commits used when provisioning workspaces.
 */

const FULL_SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/i;

export function isFullGitSha(value: string): boolean {
  return FULL_SHA_RE.test(value.trim());
}

/**
 * Normalize a caller-supplied base commit. Returns null for empty input.
 * Throws when the value is present but not a full SHA (40 or 64 hex chars).
 */
export function normalizeBaseCommit(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isFullGitSha(trimmed)) {
    throw new Error("baseCommit must be a full git SHA (40 or 64 hex characters)");
  }
  return trimmed.toLowerCase();
}

/**
 * Best-effort validation that does not throw (for optional resolution paths).
 */
export function tryNormalizeBaseCommit(value: string | null | undefined): string | null {
  try {
    return normalizeBaseCommit(value);
  } catch {
    return null;
  }
}
