import { getRedisClient, RedisKeys } from "@gitterm/redis";
import { updateWorkspaceByIdAndInvalidate } from "./workspace-mutations";

const LAST_ACTIVE_TTL_SECONDS = 7 * 24 * 60 * 60;
const LAST_ACTIVE_DB_PERSIST_THROTTLE_SECONDS = 5 * 60;

function logActivityCacheError(action: string, error: unknown) {
  if (process.env.DEBUG_PROXY_RESOLVE === "true") {
    console.warn(`[WORKSPACE-ACTIVITY] ${action} failed`, error);
  }
}

export async function recordWorkspaceActivity(workspaceId: string, now = new Date()): Promise<void> {
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

    await redis.set(RedisKeys.workspaceLastActive(workspaceId), timestamp, "EX", LAST_ACTIVE_TTL_SECONDS);

    if (shouldPersist === "OK") {
      await updateWorkspaceByIdAndInvalidate(workspaceId, {
        lastActiveAt: now,
        updatedAt: now,
      });
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

export async function filterIdleWorkspacesByRedisActivity<T extends { id: string; lastActiveAt: Date | null }>(
  workspaces: T[],
  idleThreshold: Date,
): Promise<T[]> {
  if (workspaces.length === 0) return workspaces;

  try {
    const redis = getRedisClient();
    const timestamps = await redis.mget(
      workspaces.map((candidate) => RedisKeys.workspaceLastActive(candidate.id)),
    );

    return workspaces.filter((candidate, index) => {
      const redisTimestamp = timestamps[index];
      const lastActiveAt = redisTimestamp ? new Date(redisTimestamp) : candidate.lastActiveAt;
      return !lastActiveAt || lastActiveAt < idleThreshold;
    });
  } catch (error) {
    logActivityCacheError("idle filter", error);
    return workspaces.filter(
      (candidate) => !candidate.lastActiveAt || candidate.lastActiveAt < idleThreshold,
    );
  }
}
