import { getRedisClient, RedisKeys } from "@gitterm/redis";
import { db, eq, and } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { user } from "@gitterm/db/schema/auth";
import { getProviderByCloudProviderId } from "../providers";
import { updateWorkspaceByIdAndInvalidate } from "./workspace-mutations";
import { getWorkspaceIdleTimeoutMs } from "./workspace-timeouts";
import { isAnonEmail } from "./anon/anon-user";

const LAST_ACTIVE_TTL_SECONDS = 7 * 24 * 60 * 60;
const LAST_ACTIVE_DB_PERSIST_THROTTLE_SECONDS = 5 * 60;

function logActivityCacheError(action: string, error: unknown) {
  if (process.env.DEBUG_PROXY_RESOLVE === "true") {
    console.warn(`[WORKSPACE-ACTIVITY] ${action} failed`, error);
  }
}

async function keepProviderWorkspaceAlive(workspaceId: string): Promise<void> {
  try {
    const [ws] = await db
      .select({
        externalInstanceId: workspace.externalInstanceId,
        userId: workspace.userId,
        providerKey: cloudProvider.providerKey,
        email: user.email,
      })
      .from(workspace)
      .innerJoin(cloudProvider, eq(workspace.cloudProviderId, cloudProvider.id))
      .leftJoin(user, eq(workspace.userId, user.id))
      .where(and(eq(workspace.id, workspaceId), eq(workspace.status, "running")))
      .limit(1);

    if (!ws) return;

    // Anon "try gitterm" sandboxes run with a hard E2B kill-on-timeout lease
    // (see `providers/e2b/index.ts` → `createEphemeralAnonWorkspace`). Extending
    // their timeout on every interaction would defeat the 10-minute cap, so we
    // skip the provider keep-alive for them entirely.
    if (isAnonEmail(ws.email)) return;

    const provider = await getProviderByCloudProviderId(ws.providerKey);
    if (!provider.keepAliveWorkspace) return;

    await provider.keepAliveWorkspace(
      ws.externalInstanceId,
      await getWorkspaceIdleTimeoutMs(ws.userId),
    );
  } catch (error) {
    logActivityCacheError("provider keep-alive", error);
  }
}

export async function recordWorkspaceActivity(
  workspaceId: string,
  now = new Date(),
): Promise<void> {
  const timestamp = now.toISOString();

  try {
    const redis = getRedisClient();
    const shouldPersist = await redis.set(
      RedisKeys.workspaceLastActivePersistThrottle(workspaceId),
      "1",
      "EX",
      LAST_ACTIVE_DB_PERSIST_THROTTLE_SECONDS,
      "NX",
    );

    await redis.set(
      RedisKeys.workspaceLastActive(workspaceId),
      timestamp,
      "EX",
      LAST_ACTIVE_TTL_SECONDS,
    );

    if (shouldPersist === "OK") {
      await updateWorkspaceByIdAndInvalidate(workspaceId, {
        lastActiveAt: now,
        updatedAt: now,
      });
      await keepProviderWorkspaceAlive(workspaceId);
    }
  } catch (error) {
    logActivityCacheError("record", error);
    await updateWorkspaceByIdAndInvalidate(workspaceId, {
      lastActiveAt: now,
      updatedAt: now,
    });
  }
}

export async function getWorkspaceLastActivity(workspaceId: string): Promise<Date | null> {
  try {
    const timestamp = await getRedisClient().get(RedisKeys.workspaceLastActive(workspaceId));
    return timestamp ? new Date(timestamp) : null;
  } catch (error) {
    logActivityCacheError("read", error);
    return null;
  }
}

export async function filterIdleWorkspacesByRedisActivity<
  T extends { id: string; lastActiveAt: Date | null },
>(workspaces: T[], idleThreshold: Date): Promise<T[]> {
  return filterIdleWorkspacesByRedisActivityWith(workspaces, () => idleThreshold);
}

/**
 * Like `filterIdleWorkspacesByRedisActivity` but resolves the idle threshold
 * per-workspace. This lets callers apply per-plan idle timeouts while still
 * honouring the fresher Redis activity timestamp over the (throttled) DB value.
 */
export async function filterIdleWorkspacesByRedisActivityWith<
  T extends { id: string; lastActiveAt: Date | null },
>(workspaces: T[], thresholdFor: (workspace: T) => Date): Promise<T[]> {
  if (workspaces.length === 0) return workspaces;

  try {
    const redis = getRedisClient();
    const timestamps = await redis.mget(
      workspaces.map((candidate) => RedisKeys.workspaceLastActive(candidate.id)),
    );

    return workspaces.filter((candidate, index) => {
      const redisTimestamp = timestamps[index];
      const lastActiveAt = redisTimestamp ? new Date(redisTimestamp) : candidate.lastActiveAt;
      return !lastActiveAt || lastActiveAt < thresholdFor(candidate);
    });
  } catch (error) {
    logActivityCacheError("idle filter", error);
    return workspaces.filter(
      (candidate) => !candidate.lastActiveAt || candidate.lastActiveAt < thresholdFor(candidate),
    );
  }
}
