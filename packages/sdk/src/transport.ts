const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function normalizeServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid GitTerm server URL: ${value}`);
  }

  if (url.username || url.password) {
    throw new Error("GitTerm server URL must not contain credentials");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  ) {
    throw new Error("GitTerm server URL must use HTTPS (HTTP is allowed only for loopback)");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function withPath(serverUrl: string, pathname: string): string {
  const url = new URL(serverUrl);
  url.pathname = pathname;
  return url.toString();
}

function basePath(serverUrl: string): string {
  return new URL(serverUrl).pathname.replace(/\/+$/, "");
}

/**
 * Resolve the tRPC endpoint relative to the server URL's path, so a base like
 * `https://host/api` (path-routing proxy) maps to `https://host/api/trpc`.
 */
export function trpcEndpoint(serverUrl: string): string {
  const base = basePath(serverUrl);
  return withPath(serverUrl, base.endsWith("/trpc") ? base : `${base}/trpc`);
}

/** Resolve a server `/api/*` route, adding `/api` only when the base doesn't already end in it. */
export function apiEndpoint(serverUrl: string, route: string): string {
  const base = basePath(serverUrl);
  const apiBase = base.endsWith("/api") ? base : `${base}/api`;
  return withPath(serverUrl, `${apiBase}/${route.replace(/^\/+/, "")}`);
}

export function createNoRedirectFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return (async (input, init) => {
    const response = await fetchImpl(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      throw new Error(
        location
          ? `GitTerm server redirects are not allowed: ${location}`
          : "GitTerm server redirects are not allowed",
      );
    }
    return response;
  }) as typeof fetch;
}
