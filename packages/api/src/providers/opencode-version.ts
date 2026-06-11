/**
 * Resolve the latest published opencode version from GitHub releases.
 *
 * Used when building provider images/templates so the install layer is pinned
 * to a concrete version: this makes builds deterministic and busts any build
 * cache whenever a new opencode version is released (avoiding stale versions).
 */
export async function getLatestOpencodeVersion(): Promise<string> {
  const res = await fetch("https://api.github.com/repos/sst/opencode/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to resolve latest opencode version: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { tag_name?: string };
  const version = data.tag_name?.replace(/^v/, "");

  if (!version) {
    throw new Error("Could not parse latest opencode version from GitHub release.");
  }

  return version;
}
