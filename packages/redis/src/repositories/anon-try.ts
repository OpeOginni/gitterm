import { getRedisClient } from "../client";
import { RedisKeys } from "../keys";

/**
 * Rate-limit + memoization helper for the anonymous "try gitterm" homepage flow.
 *
 * Policy: one anonymous workspace launch per IP-hash per 24 hours.
 * Implementation: atomic `SET key 1 EX 86400 NX` — if it returns null the
 * caller has already burned their slot in the current window.
 *
 * We also cache the synthetic anon user id keyed by IP-hash so repeat IPs
 * (after the cooldown) reuse the same user row, keeping their workspace
 * count under a stable quota.
 */

const ANON_TRY_WINDOW_SECONDS = 60 * 60 * 24; // 24 hours
const ANON_USER_ID_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface AnonRateLimitConsumeResult {
  ok: boolean;
  retryInSeconds?: number;
}

export class AnonTryRepository {
  private redis = getRedisClient();

  /**
   * Try to consume a launch slot for this IP. Returns `{ ok: true }` if the
   * caller is cleared to proceed. If they already used their slot in the
   * current window, returns `{ ok: false, retryInSeconds }`.
   */
  async consumeSlot(ipHash: string): Promise<AnonRateLimitConsumeResult> {
    const key = RedisKeys.anonTryIp(ipHash);
    const set = await this.redis.set(key, "1", "EX", ANON_TRY_WINDOW_SECONDS, "NX");
    if (set === "OK") {
      return { ok: true };
    }
    const ttl = await this.redis.ttl(key);
    return {
      ok: false,
      retryInSeconds: ttl > 0 ? ttl : ANON_TRY_WINDOW_SECONDS,
    };
  }

  /**
   * Release the slot — used to refund the rate-limit token on internal failure
   * (e.g. E2B fails to spawn). The user shouldn't be locked out for 24h
   * because of an upstream error.
   */
  async releaseSlot(ipHash: string): Promise<void> {
    await this.redis.del(RedisKeys.anonTryIp(ipHash));
  }

  /**
   * Get the cached anon user id for an IP-hash, if any.
   */
  async getCachedUserId(ipHash: string): Promise<string | null> {
    return this.redis.get(RedisKeys.anonTryUser(ipHash));
  }

  /**
   * Cache the anon user id keyed by IP-hash for 30 days.
   */
  async cacheUserId(ipHash: string, userId: string): Promise<void> {
    await this.redis.set(RedisKeys.anonTryUser(ipHash), userId, "EX", ANON_USER_ID_TTL_SECONDS);
  }
}
