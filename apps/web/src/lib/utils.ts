import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import env from "@gitterm/env/web";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Workspace URL Utilities
 *
 * URLs are constructed from subdomain based on routing mode.
 * The backend handles proxying to the actual upstream.
 */

function getProtocolForBaseDomain(baseDomain: string): "http" | "https" {
  // local dev: "localhost:8888" or "127.0.0.1:8888"
  if (baseDomain.includes("localhost") || baseDomain.includes("127.0.0.1")) return "http";
  return "https";
}

/**
 * Construct a workspace URL from subdomain
 */
export function getWorkspaceUrl(subdomain: string): string {
  const protocol = getProtocolForBaseDomain(env.NEXT_PUBLIC_BASE_DOMAIN);
  if (env.NEXT_PUBLIC_ROUTING_MODE === "path") {
    return `${protocol}://${env.NEXT_PUBLIC_BASE_DOMAIN}/ws/${subdomain}`;
  }

  return `${protocol}://${subdomain}.${env.NEXT_PUBLIC_BASE_DOMAIN}`;
}

/**
 * Construct a workspace open port URL from subdomain and port
 */
export function getWorkspaceOpenPortUrl(subdomain: string, port: number): string {
  const protocol = getProtocolForBaseDomain(env.NEXT_PUBLIC_BASE_DOMAIN);
  if (env.NEXT_PUBLIC_ROUTING_MODE === "path") {
    return `${protocol}://${env.NEXT_PUBLIC_BASE_DOMAIN}/ws/${port}-${subdomain}`;
  }
  return `${protocol}://${port}-${subdomain}.${env.NEXT_PUBLIC_BASE_DOMAIN}`;
}

/**
 * Construct the opencode attach command
 */
export function getAttachCommand(subdomain: string, agentName: string): string {
  const url = getWorkspaceUrl(subdomain);

  // TODO: Better agent name detection
  if (agentName.toLocaleLowerCase().includes("opencode")) {
    return `opencode attach ${url}`;
  }
  if (agentName.toLocaleLowerCase().includes("shuvcode")) {
    return `shuvcode attach ${url}`;
  }

  return `opencode attach ${url}`;
}

/**
 * Get display text for a workspace URL
 * Shows the URL without protocol for cleaner display
 */
export function getWorkspaceDisplayUrl(subdomain: string): string {
  if (env.NEXT_PUBLIC_ROUTING_MODE === "path") {
    return `${env.NEXT_PUBLIC_BASE_DOMAIN}/ws/${subdomain}`;
  }

  return `${subdomain}.${env.NEXT_PUBLIC_BASE_DOMAIN}`;
}

// ============================================================================
// Agent (tunnel workspace) command helpers
// ============================================================================

/**
 * True when running on the managed hosted domain.
 * In that case, the agent defaults (api.gitterm.dev + tunnel.gitterm.dev) work.
 */
export function isHostedGittermDomain(): boolean {
  // Prefer runtime host check so local/self-hosted doesn't depend on NEXT_PUBLIC_BASE_DOMAIN being configured.
  if (typeof window !== "undefined") {
    return window.location.hostname === "gitterm.dev";
  }
  return env.NEXT_PUBLIC_BASE_DOMAIN === "gitterm.dev";
}

/**
 * Agent expects a server *origin* (it appends `/api/...` internally),
 * so we normalize any configured API URL back to its origin.
 */
export function getAgentServerUrlOrigin(currentOrigin?: string): string | undefined {
  const configured = env.NEXT_PUBLIC_SERVER_URL;
  if (configured) {
    try {
      // UI may provide an API base (e.g. http://localhost:8888/api). Agent needs the origin.
      return new URL(configured).origin;
    } catch {
      // fall through
    }
  }
  if (currentOrigin) return currentOrigin;
  if (typeof window !== "undefined") return window.location.origin;
  return undefined;
}

/**
 * Compute the tunnel-proxy websocket URL for the agent.
 *
 * Priority:
 * - NEXT_PUBLIC_TUNNEL_URL (if set) — can be http(s) or ws(s); we normalize to ws(s) + `/tunnel/connect`
 * - otherwise derive from current origin as `${origin}/tunnel/connect` (matches `apps/proxy/Caddyfile.local`)
 */
export function getAgentWsUrl(currentOrigin?: string): string | undefined {
  const configured = env.NEXT_PUBLIC_TUNNEL_URL;
  const fallbackOrigin = getAgentServerUrlOrigin(currentOrigin);
  const base = configured ?? fallbackOrigin;
  if (!base) return undefined;
  try {
    const u = new URL(base);
    u.protocol = u.protocol === "https:" ? "wss:" : u.protocol === "http:" ? "ws:" : u.protocol;
    u.pathname = "/tunnel/connect";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return undefined;
  }
}

/**
 * Build the `gitterm-agent connect` command.
 * - Hosted: keep it minimal.
 * - Self-hosted: include `--ws-url` + `--server-url` so the agent knows where to connect.
 */
export function getAgentConnectCommand(
  workspaceId: string,
  opts?: { currentOrigin?: string },
): string {
  const base = `npx gitterm tunnel --w ${workspaceId}`;

  if (isHostedGittermDomain()) return base;

  const serverUrl = getAgentServerUrlOrigin(opts?.currentOrigin);
  if (!serverUrl) return base;

  // With the new backend response, the agent can learn wsUrl after auth.
  return `${base} --server-url ${serverUrl}`;
}
