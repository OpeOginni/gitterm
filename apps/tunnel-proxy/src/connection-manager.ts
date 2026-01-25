import { TunnelRepository } from "@gitterm/redis";
import { createInternalClient } from "@gitterm/api/client";
import { Multiplexer } from "./mux";
import env from "@gitterm/env/tunnel-proxy";

// Create internal client for service-to-service communication
const internalClient = createInternalClient(
  env.SERVER_URL || "http://localhost:3000",
  env.INTERNAL_API_KEY || "",
);

export interface ConnectedAgent {
  subdomain: string;
  workspaceId: string;
  userId: string;
  ws: WebSocket;
  connectedAt: number;
  lastSeenAt: number;
  mux: Multiplexer;
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

export class ConnectionManager {
  private tunnelRepo = new TunnelRepository();
  private connections = new Map<string, ConnectedAgent>();

  private idleTimeoutMs = 90_000;
  private heartbeatIntervalMs = 25_000;

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

    agent.heartbeatTimer = setInterval(() => {
      const current = this.connections.get(params.subdomain);
      if (!current) return;

      // Proactively ping; agent responds via `pong`.
      try {
        current.ws.send(
          JSON.stringify({ type: "ping", id: crypto.randomUUID(), timestamp: Date.now() }),
        );
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
    }, this.heartbeatIntervalMs);

    this.connections.set(params.subdomain, agent);

    await this.tunnelRepo.registerConnection({
      subdomain: params.subdomain,
      workspaceId: params.workspaceId,
      userId: params.userId,
      primaryPort: params.primaryPort,
      exposedPorts: params.exposedPorts,
      instanceId: env.INSTANCE_ID,
    });
  }

  async unregister(subdomain: string) {
    const agent = this.connections.get(subdomain);
    if (agent) {
      if (agent.heartbeatTimer) clearInterval(agent.heartbeatTimer);
      agent.mux.rejectAll(new Error("tunnel disconnected"));

      // Mark workspace as pending so user can reconnect
      try {
        await internalClient.internal.markWorkspacePendingInternal.mutate({
          workspaceId: agent.workspaceId,
        });
      } catch (error) {
        console.error(`Failed to mark workspace pending on disconnect: ${error}`);
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
