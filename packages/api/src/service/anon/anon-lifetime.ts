export const ANON_WORKSPACE_TTL_SECONDS = 10 * 60;

export function isAnonWorkspaceExpired(
  ownerEmail: string | null | undefined,
  startedAt: Date | string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!ownerEmail?.endsWith("@anon.gitterm.local") || !startedAt) return false;

  const startedAtMs = new Date(startedAt).getTime();
  return Number.isFinite(startedAtMs) && nowMs >= startedAtMs + ANON_WORKSPACE_TTL_SECONDS * 1_000;
}
