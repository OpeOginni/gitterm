/**
 * Resolve the latest published t3 (T3 Code) version from GitHub releases.
 *
 * Used when building provider images/templates so the install layer is pinned
 * to a concrete version: this makes builds deterministic and busts any build
 * cache whenever a new t3 version is released (avoiding stale versions).
 */
export async function getLatestT3Version(): Promise<string> {
  const res = await fetch("https://api.github.com/repos/pingdotgg/t3code/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to resolve latest t3 version: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { tag_name?: string };
  const version = data.tag_name?.replace(/^v/, "");

  if (!version) {
    throw new Error("Could not parse latest t3 version from GitHub release.");
  }

  return version;
}
