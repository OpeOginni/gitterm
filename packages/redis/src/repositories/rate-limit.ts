import { getRedisClient } from "../client";
import { RedisKeys } from "../keys";
import type { RateLimitConfig, RateLimitResult } from "../types";

export class RateLimitRepository {
	private redis = getRedisClient();

	async check(userId: string, config: RateLimitConfig): Promise<RateLimitResult> {
		const now = Date.now();
		const windowMs = 60_000;
		const key = RedisKeys.rateLimit(userId);

		const pipeline = this.redis.pipeline();
		pipeline.zremrangebyscore(key, 0, now - windowMs);
		pipeline.zadd(key, now, `${now}-${Math.random()}`);
		pipeline.zcard(key);
		pipeline.expire(key, 120);
		const results = await pipeline.exec();

		const count = (results?.[2]?.[1] as number) ?? 0;
		const allowed = count <= config.requestsPerMinute;
		return {
			allowed,
			remaining: Math.max(0, config.requestsPerMinute - count),
			resetAt: now + windowMs,
		};
	}
}
