import { db, eq } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import { getRedisClient, RedisKeys } from "@gitterm/redis";

export const PROXY_WORKSPACE_CACHE_TTL_SECONDS = 15;
export const PROXY_WORKSPACE_MISS_TTL_SECONDS = 60;
export const PROXY_ROUTE_ACCESS_TTL_SECONDS = 15;

const NEGATIVE_WORKSPACE_CACHE_TTL_MS = 60_000;
const MAX_NEGATIVE_WORKSPACE_CACHE_SIZE = 1_000;
const negativeWorkspaceCache = new Map<string, number>();

export type ProxyWorkspaceCacheEntry = {
  id: string;
  subdomain: string | null;
  userId: string;
  upstreamUrl: string | null;
  hostingType: "cloud" | "local";
  status: "running";
  serverOnly: boolean;
  exposedPorts?: Record<
    string,
    { port: number; name?: string; upstreamUrl?: string; externalPortDomainId?: string }
  > | null;
};

function logRedisCacheError(action: string, error: unknown) {
  if (process.env.DEBUG_PROXY_RESOLVE === "true") {
    console.warn(`[PROXY-CACHE] ${action} failed`, error);
  }
}

export function hasRecentProxyWorkspaceMiss(subdomain: string) {
  const expiresAt = negativeWorkspaceCache.get(subdomain);
  if (!expiresAt) return false;
  if (expiresAt > Date.now()) return true;
  negativeWorkspaceCache.delete(subdomain);
  return false;
}

export function cacheProxyWorkspaceMiss(subdomain: string) {
  if (negativeWorkspaceCache.size >= MAX_NEGATIVE_WORKSPACE_CACHE_SIZE) {
    const oldestKey = negativeWorkspaceCache.keys().next().value;
    if (oldestKey) negativeWorkspaceCache.delete(oldestKey);
  }
  negativeWorkspaceCache.set(subdomain, Date.now() + NEGATIVE_WORKSPACE_CACHE_TTL_MS);
}

export function invalidateLocalProxyWorkspaceMiss(subdomain: string | null | undefined) {
  if (subdomain) negativeWorkspaceCache.delete(subdomain);
}

export async function getCachedProxyWorkspace(
  subdomain: string,
): Promise<ProxyWorkspaceCacheEntry | null> {
  try {
    const cached = await getRedisClient().get(RedisKeys.proxyWorkspace(subdomain));
    return cached ? (JSON.parse(cached) as ProxyWorkspaceCacheEntry) : null;
  } catch (error) {
    logRedisCacheError("workspace read", error);
    return null;
  }
}

export async function setCachedProxyWorkspace(
  subdomain: string,
  value: ProxyWorkspaceCacheEntry,
): Promise<void> {
  try {
    await getRedisClient().set(
      RedisKeys.proxyWorkspace(subdomain),
      JSON.stringify(value),
      "EX",
      PROXY_WORKSPACE_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    logRedisCacheError("workspace write", error);
  }
}

export async function hasCachedProxyWorkspaceMiss(subdomain: string): Promise<boolean> {
  try {
    return (await getRedisClient().exists(RedisKeys.proxyWorkspaceMiss(subdomain))) === 1;
  } catch (error) {
    logRedisCacheError("workspace miss read", error);
    return false;
  }
}

export async function setCachedProxyWorkspaceMiss(subdomain: string): Promise<void> {
  try {
    await getRedisClient().set(
      RedisKeys.proxyWorkspaceMiss(subdomain),
      "1",
      "EX",
      PROXY_WORKSPACE_MISS_TTL_SECONDS,
    );
  } catch (error) {
    logRedisCacheError("workspace miss write", error);
  }
}

export async function getCachedProxyRouteAccess(
  workspaceId: string,
  port: number | null,
): Promise<Record<string, string> | null | undefined> {
  try {
    const cached = await getRedisClient().get(RedisKeys.proxyRouteAccess(workspaceId, port));
    if (!cached) return undefined;
    return cached === "null" ? null : (JSON.parse(cached) as Record<string, string>);
  } catch (error) {
    logRedisCacheError("route access read", error);
    return undefined;
  }
}

export async function setCachedProxyRouteAccess(
  workspaceId: string,
  port: number | null,
  value: Record<string, string> | null,
): Promise<void> {
  try {
    await getRedisClient().set(
      RedisKeys.proxyRouteAccess(workspaceId, port),
      value === null ? "null" : JSON.stringify(value),
      "EX",
      PROXY_ROUTE_ACCESS_TTL_SECONDS,
    );
  } catch (error) {
    logRedisCacheError("route access write", error);
  }
}

export async function invalidateProxyCacheForWorkspace(input: {
  workspaceId: string;
  subdomain?: string | null;
}): Promise<void> {
  try {
    let subdomain = input.subdomain;
    if (subdomain === undefined) {
      const [ws] = await db
        .select({ subdomain: workspace.subdomain })
        .from(workspace)
        .where(eq(workspace.id, input.workspaceId))
        .limit(1);
      subdomain = ws?.subdomain ?? null;
    }

    const redis = getRedisClient();
    const keys: string[] = [RedisKeys.proxyRouteAccess(input.workspaceId, null)];
    if (subdomain) {
      invalidateLocalProxyWorkspaceMiss(subdomain);
      keys.push(RedisKeys.proxyWorkspace(subdomain), RedisKeys.proxyWorkspaceMiss(subdomain));
    }

    let cursor = "0";
    do {
      const [nextCursor, routeKeys] = await redis.scan(
        cursor,
        "MATCH",
        `proxy:route_access:${input.workspaceId}:*`,
        "COUNT",
        "100",
      );
      cursor = nextCursor;
      keys.push(...routeKeys);
    } while (cursor !== "0");

    if (keys.length > 0) {
      await redis.del(...Array.from(new Set(keys)));
    }
  } catch (error) {
    logRedisCacheError("invalidate workspace", error);
  }
}

export async function invalidateProxyRouteAccessCache(
  workspaceId: string,
  port: number | null,
): Promise<void> {
  try {
    await getRedisClient().del(RedisKeys.proxyRouteAccess(workspaceId, port));
  } catch (error) {
    logRedisCacheError("invalidate route access", error);
  }
}

export async function invalidateAllProxyRouteAccessCache(workspaceId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const keys = [RedisKeys.proxyRouteAccess(workspaceId, null)];

    let cursor = "0";
    do {
      const [nextCursor, routeKeys] = await redis.scan(
        cursor,
        "MATCH",
        `proxy:route_access:${workspaceId}:*`,
        "COUNT",
        "100",
      );
      cursor = nextCursor;
      keys.push(...routeKeys);
    } while (cursor !== "0");

    await redis.del(...Array.from(new Set(keys)));
  } catch (error) {
    logRedisCacheError("invalidate all route access", error);
  }
}
