/** npm package that publishes the OpenCode 2 CLI (`opencode-ai` stays on 1.x). */
export const OPENCODE_PACKAGE = "@opencode/cli";

/**
 * Resolve an exact OpenCode 2 package version and fail closed on any other major.
 *
 * Used when building provider images/templates so the install layer is pinned
 * to a concrete version: this makes builds deterministic and busts any build
 * cache whenever a new opencode version is released (avoiding stale versions).
 */
export async function getLatestOpencodeVersion(
  requested = process.env.OPENCODE_VERSION?.trim() || "2",
): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${OPENCODE_PACKAGE}`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to resolve OpenCode version: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    "dist-tags"?: { latest?: string };
    versions?: Record<string, unknown>;
  };
  const normalized = requested.replace(/^v/, "");
  const version =
    normalized === "2" || normalized === "latest" ? data["dist-tags"]?.latest : normalized;

  if (!version || !/^2\.[0-9]+\.[0-9]+$/.test(version) || !data.versions?.[version]) {
    throw new Error(
      `OpenCode version must resolve to a published OpenCode 2 release; received ${requested}`,
    );
  }

  return version;
}
