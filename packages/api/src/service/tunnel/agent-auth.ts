import { agentJWT } from "./agent-jwt";
import { tunnelJWT } from "./tunnel-jwt";
import { DeviceCodeRepository } from "@gitpad/redis";
import { db, eq } from "@gitpad/db";
import { workspace } from "@gitpad/db/schema/workspace";
import { WORKSPACE_EVENTS } from "../../events/workspace";

export class AgentAuthService {
	private deviceRepo = new DeviceCodeRepository();

	async exchangeDeviceCode(deviceCode: string): Promise<{ agentToken: string } | null> {
		const consumed = await this.deviceRepo.consumeApprovedDeviceCode(deviceCode);
		if (!consumed) return null;
		return { agentToken: agentJWT.generateToken({ userId: consumed.userId }) };
	}

	async mintTunnelToken(params: { agentToken: string; workspaceId: string }) {
		let payload: { userId: string };
		try {
			payload = agentJWT.verifyToken(params.agentToken);
		} catch {
			throw new Error("Unauthorized");
		}

		const userId = payload.userId;
		const [ws] = await db.select().from(workspace).where(eq(workspace.id, params.workspaceId)).limit(1);
		if (!ws) throw new Error("Not found");
		if (ws.userId !== userId) throw new Error("Forbidden");
		if (ws.tunnelType !== "local") throw new Error("Workspace is not a local tunnel");

		const tokenExposedPorts: Record<string, number> = {};
		if (ws.localPort) tokenExposedPorts.root = ws.localPort;
		for (const [serviceName, entry] of Object.entries(ws.exposedPorts ?? {})) {
			tokenExposedPorts[serviceName] = entry.port;
		}

		const token = tunnelJWT.generateToken({
			workspaceId: ws.id,
			userId,
			subdomain: ws.subdomain ?? "",
			scopes: ["tunnel:connect"],
			exposedPorts: tokenExposedPorts,
		});

		return {
			token,
			expiresInSeconds: 10 * 60,
			subdomain: ws.subdomain,
			workspaceId: ws.id,
			userId,
		};
	}

	async updateWorkspacePorts(params: {
		agentToken: string;
		workspaceId: string;
		localPort: number;
		exposedPorts: Record<string, { port: number; description?: string }>;
	}) {
		let payload: { userId: string };
		try {
			payload = agentJWT.verifyToken(params.agentToken);
		} catch {
			throw new Error("Unauthorized");
		}

		const userId = payload.userId;
		const [ws] = await db.select().from(workspace).where(eq(workspace.id, params.workspaceId)).limit(1);
		if (!ws) throw new Error("Not found");
		if (ws.userId !== userId) throw new Error("Forbidden");
		if (ws.tunnelType !== "local") throw new Error("Workspace is not a local tunnel");

		await db
			.update(workspace)
			.set({
				localPort: params.localPort,
				exposedPorts: params.exposedPorts,
				status: "running",
				tunnelConnectedAt: new Date(),
				tunnelLastPingAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(workspace.id, params.workspaceId));

		WORKSPACE_EVENTS.emitStatus({
			workspaceId: params.workspaceId,
			status: "running",
			updatedAt: new Date(),
			userId: userId,
			workspaceDomain: ws.domain,
		});

		return { success: true };
	}
}
