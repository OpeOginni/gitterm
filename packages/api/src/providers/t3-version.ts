/**
 * Resolve a published t3 version from npm, the actual image installation source.
 *
 * Used when building provider images/templates so the install layer is pinned
 * to a concrete version: this makes builds deterministic and busts any build
 * cache whenever a new t3 version is released (avoiding stale versions).
 */
export async function getLatestT3Version(
  requested = process.env.T3_VERSION?.trim() || "latest",
): Promise<string> {
  const normalized = requested.replace(/^v/, "");
  if (normalized !== "latest" && !/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error("T3 version must be latest or an exact stable semver");
  }
  const res = await fetch(`https://registry.npmjs.org/t3/${normalized}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Failed to resolve latest t3 version: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { version?: string };
  const version = data.version;

  if (
    !version ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    (normalized !== "latest" && version !== normalized)
  ) {
    throw new Error("Could not resolve a published stable t3 version from npm.");
  }

  return version;
}
