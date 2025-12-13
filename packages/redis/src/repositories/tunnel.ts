import { getRedisClient } from "../client";
import { RedisKeys } from "../keys";
import type { TunnelConnectionInfo } from "../types";

const CONNECTION_TTL_SECONDS = 60 * 5;

export class TunnelRepository {
	private redis = getRedisClient();

	async registerConnection(info: Omit<TunnelConnectionInfo, "connectedAt" | "lastPingAt">) {
		const now = Date.now();
		const key = RedisKeys.tunnelConnection(info.subdomain);

		await this.redis.hset(key, {
			workspaceId: info.workspaceId,
			userId: info.userId,
			subdomain: info.subdomain,
			primaryPort: info.primaryPort,
			exposedPorts: JSON.stringify(info.exposedPorts ?? {}),
			connectedAt: now,
			lastPingAt: now,
			instanceId: info.instanceId,
		});
		await this.redis.expire(key, CONNECTION_TTL_SECONDS);

		const pipeline = this.redis.pipeline();
		pipeline.set(RedisKeys.tunnelServicePort(info.subdomain), String(info.primaryPort));
		pipeline.expire(RedisKeys.tunnelServicePort(info.subdomain), CONNECTION_TTL_SECONDS);
		pipeline.set(RedisKeys.tunnelServiceBase(info.subdomain), info.subdomain);
		pipeline.expire(RedisKeys.tunnelServiceBase(info.subdomain), CONNECTION_TTL_SECONDS);

		for (const [serviceName, port] of Object.entries(info.exposedPorts ?? {})) {
			const fullSubdomain = `${info.subdomain}-${serviceName}`;
			pipeline.set(RedisKeys.tunnelServicePort(fullSubdomain), String(port));
			pipeline.expire(RedisKeys.tunnelServicePort(fullSubdomain), CONNECTION_TTL_SECONDS);
			pipeline.set(RedisKeys.tunnelServiceBase(fullSubdomain), info.subdomain);
			pipeline.expire(RedisKeys.tunnelServiceBase(fullSubdomain), CONNECTION_TTL_SECONDS);
		}

		pipeline.sadd(RedisKeys.userTunnels(info.userId), info.workspaceId);
		await pipeline.exec();
	}

	async getConnection(subdomain: string): Promise<TunnelConnectionInfo | null> {
		const data = await this.redis.hgetall(RedisKeys.tunnelConnection(subdomain));

		const workspaceId = data.workspaceId;
		const userId = data.userId;
		const storedSubdomain = data.subdomain;
		const primaryPort = data.primaryPort;
		const connectedAt = data.connectedAt;
		const lastPingAt = data.lastPingAt;
		const instanceId = data.instanceId;

		if (!workspaceId || !userId || !storedSubdomain || !primaryPort || !connectedAt || !lastPingAt || !instanceId) {
			return null;
		}

		return {
			workspaceId,
			userId,
			subdomain: storedSubdomain,
			primaryPort: Number.parseInt(primaryPort, 10),
			exposedPorts: JSON.parse(data.exposedPorts || "{}"),
			connectedAt: Number.parseInt(connectedAt, 10),
			lastPingAt: Number.parseInt(lastPingAt, 10),
			instanceId,
		};
	}

	async updateHeartbeat(subdomain: string) {
		const info = await this.getConnection(subdomain);
		if (!info) return;

		const pipeline = this.redis.pipeline();
		pipeline.hset(RedisKeys.tunnelConnection(subdomain), { lastPingAt: Date.now() });
		pipeline.expire(RedisKeys.tunnelConnection(subdomain), CONNECTION_TTL_SECONDS);

		pipeline.expire(RedisKeys.tunnelServicePort(subdomain), CONNECTION_TTL_SECONDS);
		pipeline.expire(RedisKeys.tunnelServiceBase(subdomain), CONNECTION_TTL_SECONDS);

		for (const serviceName of Object.keys(info.exposedPorts ?? {})) {
			pipeline.expire(RedisKeys.tunnelServicePort(`${subdomain}-${serviceName}`), CONNECTION_TTL_SECONDS);
			pipeline.expire(RedisKeys.tunnelServiceBase(`${subdomain}-${serviceName}`), CONNECTION_TTL_SECONDS);
		}

		await pipeline.exec();
	}

	async getServicePort(fullSubdomain: string): Promise<number | null> {
		const value = await this.redis.get(RedisKeys.tunnelServicePort(fullSubdomain));
		if (!value) return null;
		return Number.parseInt(value, 10);
	}

	async getServiceBase(fullSubdomain: string): Promise<string | null> {
		const value = await this.redis.get(RedisKeys.tunnelServiceBase(fullSubdomain));
		return value || null;
	}

	async removeConnection(subdomain: string) {
		const info = await this.getConnection(subdomain);
		if (!info) return;

		const pipeline = this.redis.pipeline();
		pipeline.del(RedisKeys.tunnelConnection(subdomain));
		pipeline.del(RedisKeys.tunnelServicePort(subdomain));
		pipeline.del(RedisKeys.tunnelServiceBase(subdomain));
		for (const serviceName of Object.keys(info.exposedPorts ?? {})) {
			pipeline.del(RedisKeys.tunnelServicePort(`${subdomain}-${serviceName}`));
			pipeline.del(RedisKeys.tunnelServiceBase(`${subdomain}-${serviceName}`));
		}
		pipeline.srem(RedisKeys.userTunnels(info.userId), info.workspaceId);
		await pipeline.exec();
	}

	async getUserTunnelCount(userId: string): Promise<number> {
		return this.redis.scard(RedisKeys.userTunnels(userId));
	}
}
