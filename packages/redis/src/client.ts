import Redis from "ioredis";

let redisClient: Redis | null = null;

export type RedisClient = Redis;

export function getRedisClient(): Redis {
	if (redisClient) return redisClient;

	const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

	redisClient = new Redis(redisUrl, {
		maxRetriesPerRequest: 3,
		enableReadyCheck: true,
		retryStrategy: (times) => Math.min(times * 50, 2000),
	});

	redisClient.on("error", (error) => {
		console.error("Redis error", error);
	});

	if (!process.env.REDIS_URL) {
		console.warn("REDIS_URL not set; defaulting to redis://localhost:6379");
	}

	return redisClient;
}

export async function closeRedisClient() {
	if (!redisClient) return;
	const client = redisClient;
	redisClient = null;
	await client.quit();
}
