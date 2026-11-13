import errorPage from "../../../../../apps/proxy/errors/unavailable.html" with { type: "text" };
import { PASSIVE_REQUEST_HEADER } from "@gitterm/agent-runtime";
import { createHash } from "node:crypto";
import { auth } from "@gitterm/auth";
import {
  agentProvisionerKeyForName,
  getAgentCapabilities,
} from "@gitterm/schema/agent-capabilities";
import { db, eq, and } from "@gitterm/db";
import { agentType, image } from "@gitterm/db/schema/cloud";
import { workspace } from "@gitterm/db/schema/workspace";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import env from "@gitterm/env/server";
import { getWorkspaceRouteAccess } from "../../service/workspace-route-access";
import {
  getCachedProxyRouteAccess,
  getCachedProxyWorkspace,
  hasRecentProxyWorkspaceMiss,
  hasCachedProxyWorkspaceMiss,
  cacheProxyWorkspaceMiss,
  setCachedProxyRouteAccess,
  setCachedProxyWorkspace,
  setCachedProxyWorkspaceMiss,
  type ProxyWorkspaceCacheEntry,
} from "../../service/proxy-cache";
import { recordWorkspaceActivity } from "../../service/workspace-activity";
import { extractWorkspaceSubdomain } from "../../utils/routing";
import { getPortVisibility } from "@gitterm/schema/workspace-ports";

const DEBUG_PROXY_RESOLVE = process.env.DEBUG_PROXY_RESOLVE === "true";

function debugProxyResolve(message: string, data?: unknown) {
  if (!DEBUG_PROXY_RESOLVE) return;
  if (data === undefined) {
    console.log(message);
    return;
  }
  console.log(message, data);
}

const ACTIVITY_WRITE_INTERVAL_MS = 10_000;
const SESSION_CACHE_TTL_MS = 15_000;
const MAX_LOCAL_ENTRIES = 10_000;
const lastActivityWrite = new Map<string, number>();
const sessionUsers = new Map<string, { userId: string | null; expiresAt: number }>();

/**
 * Idle timeouts are minutes long, so one activity write per workspace every few seconds
 * is enough, and the proxied request does not wait for it.
 */
function touchWorkspace(workspaceId: string) {
  const now = Date.now();
  if (now - (lastActivityWrite.get(workspaceId) ?? 0) < ACTIVITY_WRITE_INTERVAL_MS) return;
  if (lastActivityWrite.size >= MAX_LOCAL_ENTRIES) lastActivityWrite.clear();
  lastActivityWrite.set(workspaceId, now);
  void recordWorkspaceActivity(workspaceId).catch((error) => {
    console.error("Workspace activity write failed:", error);
  });
}

/**
 * The signed-in user for this request. The answer for a Cookie header is remembered for
 * a few seconds, so steady traffic on a private route does not query the session and
 * user tables on every request. The cost: a revoked session keeps reaching its
 * workspaces for up to SESSION_CACHE_TTL_MS.
 *
 * The key is the whole header, not one cookie picked out of it: better-auth decides
 * which cookie is the session, and a key built from a different one would let a request
 * borrow another user's answer.
 */
async function sessionUserId(headers: Headers): Promise<string | null> {
  const cookie = headers.get("cookie");
  if (!cookie) return (await auth.api.getSession({ headers }))?.user.id ?? null;

  const key = createHash("sha256").update(cookie).digest("base64");
  const cached = sessionUsers.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

  const userId = (await auth.api.getSession({ headers }))?.user.id ?? null;
  if (sessionUsers.size >= MAX_LOCAL_ENTRIES) sessionUsers.clear();
  sessionUsers.set(key, { userId, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  return userId;
}

async function getCachedOrFetchRouteAccess(workspaceId: string, port?: number | null) {
  const normalizedPort = port ?? null;
  const cached = await getCachedProxyRouteAccess(workspaceId, normalizedPort);
  if (cached !== undefined) return cached;

  const access = await getWorkspaceRouteAccess(workspaceId, port);
  await setCachedProxyRouteAccess(workspaceId, normalizedPort, access);
  return access;
}

function htmlError(c: Context, status: ContentfulStatusCode) {
  return c.html(errorPage as unknown as string, status);
}

function buildProxyResolveHeaders(
  headers: Record<string, string>,
  upstreamAccessHeaders?: Record<string, string> | null,
) {
  const responseHeaders: Record<string, string> = { ...headers };

  if (!upstreamAccessHeaders) {
    return responseHeaders;
  }

  for (const [key, value] of Object.entries(upstreamAccessHeaders)) {
    responseHeaders[key] = value;
  }

  return responseHeaders;
}

/**
 * Answers Caddy's forward_auth. A 200 must have an empty body: Caddy does not read the
 * body of a 2xx auth response, and a connection with an unread body cannot be reused,
 * so any body here costs a new TCP connection to this server per proxied request.
 */
export const proxyResolverRouter = async (c: Context) => {
  debugProxyResolve("[PROXY-RESOLVE] Request received");

  try {
    // A request that only observes the workspace (a status poll, a health check) is routed
    // like any other but is not use of it: it must not hold off the idle pause.
    const passive = c.req.header(PASSIVE_REQUEST_HEADER) !== undefined;
    const internalKey = c.req.header("X-Internal-Key") || "";
    if (!internalKey) {
      debugProxyResolve("[PROXY-RESOLVE] Missing internal key");
      return htmlError(c, 401);
    }
    if (internalKey !== env.INTERNAL_API_KEY) {
      debugProxyResolve("[PROXY-RESOLVE] Invalid internal key");
      return htmlError(c, 401);
    }

    // Extract subdomain from path (for path-based routing) or host (for subdomain routing)
    const originalUri = c.req.header("X-Original-URI") || c.req.path;
    const routingMode = c.req.header("X-Routing-Mode") || env.ROUTING_MODE;
    const host = c.req.header("Host") || "";

    let subdomain = extractWorkspaceSubdomain(host, originalUri, {
      "x-routing-mode": routingMode,
    });

    debugProxyResolve("[PROXY-RESOLVE] Extracted subdomain:", {
      subdomain,
      host,
      originalUri,
      routingMode,
    });

    if (!subdomain) {
      debugProxyResolve("[PROXY-RESOLVE] No subdomain found");
      return htmlError(c, 400);
    }

    const extractedPort = subdomain?.includes("-") ? subdomain.split("-")[0] : null;
    if (extractedPort) {
      subdomain = subdomain?.replace(`${extractedPort}-`, "");
    }

    if (hasRecentProxyWorkspaceMiss(subdomain)) {
      return htmlError(c, 404);
    }

    // Sent together so the two cache reads cost one Redis round trip.
    const [missed, cached] = await Promise.all([
      hasCachedProxyWorkspaceMiss(subdomain),
      getCachedProxyWorkspace(subdomain),
    ]);
    if (missed) {
      cacheProxyWorkspaceMiss(subdomain);
      return htmlError(c, 404);
    }

    // Check workspace - only match active (running) workspaces
    // Subdomain is not unique, so we must filter by status to get the correct one
    let ws = cached;

    if (!ws) {
      const [workspaceRecord] = await db
        .select({
          id: workspace.id,
          subdomain: workspace.subdomain,
          userId: workspace.userId,
          upstreamUrl: workspace.upstreamUrl,
          hostingType: workspace.hostingType,
          status: workspace.status,
          serverOnly: workspace.serverOnly,
          agentTypeName: agentType.name,
          agentProvisionerKey: agentType.provisionerKey,
          exposedPorts: workspace.exposedPorts,
        })
        .from(workspace)
        .innerJoin(image, eq(workspace.imageId, image.id))
        .innerJoin(agentType, eq(image.agentTypeId, agentType.id))
        .where(and(eq(workspace.subdomain, subdomain), eq(workspace.status, "running")))
        .limit(1);

      ws = (workspaceRecord as ProxyWorkspaceCacheEntry | undefined) ?? null;

      if (ws) {
        await setCachedProxyWorkspace(subdomain, ws);
      }
    }

    if (!ws) {
      cacheProxyWorkspaceMiss(subdomain);
      await setCachedProxyWorkspaceMiss(subdomain);
      debugProxyResolve("[PROXY-RESOLVE] Workspace not found for subdomain:", subdomain);
      return htmlError(c, 404);
    }

    let portUpstream: string | null = null;
    let isPublicPort = false;
    let upstreamAccessHeaders: Record<string, string> | null = null;
    if (extractedPort) {
      const exposedPort = ws.exposedPorts?.[extractedPort];
      portUpstream = exposedPort?.upstreamUrl ?? null;
      isPublicPort = getPortVisibility(exposedPort) === "public";
      if (!portUpstream) {
        debugProxyResolve(
          "[PROXY-RESOLVE] Port upstream URL not found for extracted port:",
          extractedPort,
        );
        return htmlError(c, 404);
      }

      upstreamAccessHeaders = await getCachedOrFetchRouteAccess(ws.id, Number(extractedPort));
    }

    if (!upstreamAccessHeaders) {
      upstreamAccessHeaders = await getCachedOrFetchRouteAccess(ws.id);
    }

    debugProxyResolve("[PROXY-RESOLVE] Workspace found:", {
      id: ws.id,
      subdomain: ws.subdomain,
      hostingType: ws.hostingType,
      status: ws.status,
      userId: ws.userId,
    });

    // T3 authenticates clients with its own pairing credentials. GitTerm must
    // let the primary endpoint through so discovery, pairing, and API traffic
    // can reach T3; separately exposed workspace ports remain protected.
    const agentKey = ws.agentProvisionerKey ?? agentProvisionerKeyForName(ws.agentTypeName ?? "");
    if (!extractedPort && getAgentCapabilities(agentKey ?? "")?.access === "pairing") {
      if (!ws.upstreamUrl) {
        return htmlError(c, 500);
      }

      const upstreamUrl = new URL(ws.upstreamUrl);
      const port = upstreamUrl.port || (upstreamUrl.protocol === "https:" ? "443" : "80");
      if (!passive) touchWorkspace(ws.id);

      return c.body(
        null,
        200,
        buildProxyResolveHeaders(
          {
            "X-Upstream-URL": upstreamUrl.toString(),
            "X-Container-Host": upstreamUrl.hostname,
            "X-Container-Port": port,
            "X-Container-Protocol": upstreamUrl.protocol.replace(":", ""),
            "X-Hosting-Type": ws.hostingType,
          },
          upstreamAccessHeaders,
        ),
      );
    }

    // OpenCode server workspaces own their Basic auth challenge and validation.
    // GitTerm only resolves the primary route; the client's credentials pass through Caddy.
    if (!extractedPort && ws.serverOnly) {
      if (!ws.upstreamUrl) {
        return htmlError(c, 500);
      }

      const upstreamUrl = new URL(ws.upstreamUrl);
      const port = upstreamUrl.port || (upstreamUrl.protocol === "https:" ? "443" : "80");
      if (!passive) touchWorkspace(ws.id);

      return c.body(
        null,
        200,
        buildProxyResolveHeaders(
          {
            "X-Upstream-URL": upstreamUrl.toString(),
            "X-Container-Host": upstreamUrl.hostname,
            "X-Container-Port": port,
            "X-Container-Protocol": upstreamUrl.protocol.replace(":", ""),
            "X-Hosting-Type": ws.hostingType,
          },
          upstreamAccessHeaders,
        ),
      );
    }

    // Public ports, including CORS preflights, are reachable without a GitTerm
    // session. Private ports must never forward unauthenticated OPTIONS requests.
    if (isPublicPort && portUpstream) {
      const portUrl = new URL(portUpstream);
      const port = portUrl.port || (portUrl.protocol === "https:" ? "443" : "80");
      if (!passive) touchWorkspace(ws.id);

      return c.body(
        null,
        200,
        buildProxyResolveHeaders(
          {
            "X-Upstream-URL": portUrl.toString(),
            "X-Container-Host": portUrl.hostname,
            "X-Container-Port": port,
            "X-Container-Protocol": portUrl.protocol.replace(":", ""),
            "X-Hosting-Type": ws.hostingType,
          },
          upstreamAccessHeaders,
        ),
      );
    }

    // Private workspace routes and ports are only reachable by the owner's session.
    const userId = await sessionUserId(c.req.raw.headers);

    if (!userId || userId !== ws.userId) {
      return htmlError(c, 403);
    }

    // A port has its own upstream; sandboxes have no workspace-level one.
    const target = extractedPort ? portUpstream : ws.upstreamUrl;
    if (!target) {
      return htmlError(c, 500);
    }

    const upstreamUrl = new URL(target);
    const port = upstreamUrl.port || (upstreamUrl.protocol === "https:" ? "443" : "80");

    debugProxyResolve("[PROXY-RESOLVE] Cloud workspace routing:", {
      upstreamUrl: ws.upstreamUrl,
      containerHost: upstreamUrl.hostname,
      containerPort: port,
      protocol: upstreamUrl.protocol,
      upstreamAccessHeaders: upstreamAccessHeaders,
      hasUpStreamAccessHeader: upstreamAccessHeaders !== null,
    });

    if (!passive) touchWorkspace(ws.id);

    return c.body(
      null,
      200,
      buildProxyResolveHeaders(
        {
          "X-Upstream-URL": upstreamUrl.toString(),
          "X-Container-Host": upstreamUrl.hostname,
          "X-Container-Port": port,
          "X-Container-Protocol": upstreamUrl.protocol.replace(":", ""),
          "X-User-ID": userId,
          "X-Hosting-Type": ws.hostingType,
        },
        upstreamAccessHeaders,
      ),
    );
  } catch (error) {
    console.error("Auth resolve error:", error);
    return htmlError(c, 500);
  }
};
