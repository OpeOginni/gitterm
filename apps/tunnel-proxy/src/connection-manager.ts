import { TunnelRepository } from "@gitpad/redis";
import { internalClient } from "./internal-client";
import { Multiplexer } from "./mux";

export interface ConnectedAgent {
	subdomain: string;
	workspaceId: string;
	userId: string;
	ws: WebSocket;
	connectedAt: number;
	lastSeenAt: number;
	mux: Multiplexer;
	idleTimer?: ReturnType<typeof setInterval>;
}

export class ConnectionManager {
	private tunnelRepo = new TunnelRepository();
	private connections = new Map<string, ConnectedAgent>();

	private idleTimeoutMs = process.env.TUNNEL_IDLE_TIMEOUT_MS
		? Number.parseInt(process.env.TUNNEL_IDLE_TIMEOUT_MS, 10)
		: 90_000;

	private pingIntervalMs = process.env.TUNNEL_PING_INTERVAL_MS
		? Number.parseInt(process.env.TUNNEL_PING_INTERVAL_MS, 10)
		: 25_000;

	get(subdomain: string): ConnectedAgent | undefined {
		return this.connections.get(subdomain);
	}

	markSeen(subdomain: string) {
		const agent = this.connections.get(subdomain);
		if (agent) agent.lastSeenAt = Date.now();
	}

	async register(params: {
		subdomain: string;
		workspaceId: string;
		userId: string;
		primaryPort: number;
		exposedPorts?: Record<string, number>;
		ws: WebSocket;
	}) {
		// Enforce single active connection per subdomain.
		const existing = this.connections.get(params.subdomain);
		if (existing) {
			try {
				existing.ws.close(1012, "Replaced by new connection");
			} catch {
				// ignore
			}
			await this.unregister(params.subdomain);
		}

		const now = Date.now();
		const agent: ConnectedAgent = {
			subdomain: params.subdomain,
			workspaceId: params.workspaceId,
			userId: params.userId,
			ws: params.ws,
			connectedAt: now,
			lastSeenAt: now,
			mux: new Multiplexer(),
		};

		agent.idleTimer = setInterval(() => {
			const current = this.connections.get(params.subdomain);
			if (!current) return;

			// Proactively ping; agent responds via `pong`.
			try {
				current.ws.send(JSON.stringify({ type: "ping", id: crypto.randomUUID(), timestamp: Date.now() }));
			} catch {
				// ignore
			}

			if (Date.now() - current.lastSeenAt <= this.idleTimeoutMs) return;
			try {
				current.ws.close(1001, "Idle timeout");
			} catch {
				// ignore
			}
			this.unregister(params.subdomain).catch(() => undefined);
		}, this.pingIntervalMs);

		this.connections.set(params.subdomain, agent);

		await this.tunnelRepo.registerConnection({
			subdomain: params.subdomain,
			workspaceId: params.workspaceId,
			userId: params.userId,
			primaryPort: params.primaryPort,
			exposedPorts: params.exposedPorts,
			instanceId: process.env.INSTANCE_ID || "unknown",
		});
	}

	async unregister(subdomain: string) {
		const agent = this.connections.get(subdomain);
		if (agent) {
			if (agent.idleTimer) clearInterval(agent.idleTimer);
			agent.mux.rejectAll(new Error("tunnel disconnected"));

			// Terminate the workspace (marks as terminated and closes usage session)
			try {
				await internalClient.internal.terminateWorkspaceInternal.mutate({
					workspaceId: agent.workspaceId,
				});
			} catch (error) {
				console.error(`Failed to terminate workspace on disconnect: ${error}`);
			}
		}
		this.connections.delete(subdomain);
		await this.tunnelRepo.removeConnection(subdomain);
	}

	async heartbeat(subdomain: string) {
		const agent = this.connections.get(subdomain);
		if (agent) agent.lastSeenAt = Date.now();
		await this.tunnelRepo.updateHeartbeat(subdomain);
	}
}
