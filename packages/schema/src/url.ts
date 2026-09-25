/**
 * Build a URL for a server route under /api. The base may be an origin
 * (https://api.example.com) or already end in /api (https://example.com/api);
 * /api is added exactly once either way.
 */
export function apiPath(base: string, path: string): string {
  const root = base
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
  return `${root}/api/${path.trim().replace(/^\/+/, "")}`;
}
