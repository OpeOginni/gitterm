/**
 * Routing Utilities
 *
 * Provides URL construction utilities for application.
 * Supports both subdomain-based and path-based routing modes.
 *
 * Routing Modes:
 * - subdomain: abc123.gitterm.dev (requires wildcard DNS)
 * - path: gitterm.dev/ws/abc123 (no wildcard DNS required)
 */

import env from "@gitterm/env/server";

/**
 * Check if path-based routing is enabled
 */
export function isPathRouting(): boolean {
  return env.ROUTING_MODE === "path";
}

/**
 * Check if subdomain-based routing is enabled
 */
export function isSubdomainRouting(): boolean {
  return env.ROUTING_MODE === "subdomain";
}

/**
 * Get base URL for application
 */
export function getBaseUrl(): string {
  return env.BASE_URL || `https://${env.BASE_DOMAIN}`;
}

/**
 * Get API URL
 */
export function getApiUrl(): string {
  if (env.API_URL) return env.API_URL;
  const baseUrl = getBaseUrl();
  // If base URL already has /api, use it; otherwise construct from domain
  if (baseUrl.includes("/api")) return baseUrl;
  return `https://api.${env.BASE_DOMAIN}`;
}

/**
 * Get tunnel proxy URL for agent connections
 */
export function getTunnelUrl(): string {
  if (env.TUNNEL_URL) return env.TUNNEL_URL;
  return `wss://tunnel.${env.BASE_DOMAIN}`;
}

/**
 * Construct full domain string for a workspace
 * This is stored in database for subdomain-based access
 *
 * For path-based routing, returns just the subdomain identifier
 * since the domain is constructed as BASE_DOMAIN/ws/{subdomain}
 *
 * For subdomain routing, returns subdomain.BASE_DOMAIN
 */
export function getWorkspaceDomain(subdomain: string): string {
  if (isPathRouting()) {
    // Path-based: just store the subdomain identifier
    return subdomain;
  }
  // Subdomain-based: full domain for DNS lookup
  return `${subdomain}.${env.BASE_DOMAIN}`;
}

/**
 * Construct a workspace URL given its subdomain
 *
 * In subdomain mode: https://abc123.gitterm.dev
 * In path mode: https://gitterm.dev/ws/abc123
 */
export function getWorkspaceUrl(subdomain: string): string {
  const isLocalhost =
    env.BASE_DOMAIN.includes("localhost") || env.BASE_DOMAIN.includes("127.0.0.1");
  const protocol = isLocalhost ? "http" : "https";

  if (isPathRouting()) {
    // Path-based: https://gitterm.dev/ws/{subdomain}
    return `${protocol}://${env.BASE_DOMAIN}/ws/${subdomain}`;
  }

  // Subdomain-based: https://{subdomain}.gitterm.dev
  return `${protocol}://${subdomain}.${env.BASE_DOMAIN}`;
}

/**
 * Construct a workspace URL with a specific path
 *
 * In subdomain mode: https://abc123.gitterm.dev/api/status
 * In path mode: https://gitterm.dev/ws/abc123/api/status
 */
export function getWorkspaceUrlWithPath(subdomain: string, path: string): string {
  const baseUrl = getWorkspaceUrl(subdomain);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

/**
 * Extract workspace subdomain from request context
 *
 * Supports both routing modes:
 * - Subdomain: Extract from Host header (abc123.gitterm.dev -> abc123)
 * - Path: Extract from URL path (/ws/abc123/... -> abc123) or X-Subdomain header
 * - Port-based: Extract from URL path (/ws/123-abc123/... -> abc123)
 *
 * @param host - The Host header value
 * @param path - The request path (optional, for path-based routing)
 * @param headers - Additional headers (optional, for X-Subdomain)
 */
export function extractWorkspaceSubdomain(
  host: string,
  path?: string,
  headers?: { "x-subdomain"?: string; "x-routing-mode"?: string },
): string | null {
  // If X-Subdomain header is present (set by forward_auth), use it
  if (headers?.["x-subdomain"]) {
    return headers["x-subdomain"];
  }

  // Check if this is path-based routing
  const routingMode = headers?.["x-routing-mode"] || env.ROUTING_MODE;

  if (routingMode === "path" && path) {
    // Path-based: extract from /ws/{subdomain}/...
    const match = path.match(/^\/ws\/([^/]+)/);
    return match?.[1] || null;
  }

  // Subdomain-based: extract from Host header
  const hostname = host.split(":")[0];
  if (!hostname) return null;

  const parts = hostname.split(".");
  const baseParts = env.BASE_DOMAIN.split(".");

  // Check if this is a subdomain of our base domain
  if (parts.length <= baseParts.length) return null;

  // Extract subdomain (first part before base domain)
  return parts[0] || null;
}

/**
 * Strip the workspace prefix from a path (for path-based routing)
 *
 * /ws/abc123/api/status -> /api/status
 * /api/status -> /api/status (unchanged if no prefix)
 */
export function stripWorkspacePrefix(path: string): string {
  if (!isPathRouting()) return path;

  // Remove /ws/{subdomain} prefix
  const match = path.match(/^\/ws\/[^/]+(\/.*)?$/);
  if (match) {
    return match[1] || "/";
  }
  return path;
}
