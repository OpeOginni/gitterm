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
