import jwt from "jsonwebtoken";

const TUNNEL_JWT_SECRET = process.env.TUNNEL_JWT_SECRET || "default-tunnel-secret-change-in-production";
const TUNNEL_JWT_EXPIRY = "10m";

export interface TunnelTokenPayload {
	workspaceId: string;
	userId: string;
	subdomain: string;
	scope: string[];
	// Server-issued allowlist for what this agent may expose.
	// `"root"` refers to the primary subdomain (e.g. `ws-123.gitterm.dev`).
	exposedPorts?: Record<string, number>;
	iat: number;
	exp: number;
}

export class TunnelJWTService {
	static generateToken(params: {
		workspaceId: string;
		userId: string;
		subdomain: string;
		scopes?: string[];
		exposedPorts?: Record<string, number>;
	}): string {
		const payload: Omit<TunnelTokenPayload, "iat" | "exp"> = {
			workspaceId: params.workspaceId,
			userId: params.userId,
			subdomain: params.subdomain,
			scope: params.scopes ?? ["tunnel:connect"],
			exposedPorts: params.exposedPorts,
		};

		return jwt.sign(payload, TUNNEL_JWT_SECRET, {
			algorithm: "HS256",
			expiresIn: TUNNEL_JWT_EXPIRY,
		});
	}

	static verifyToken(token: string): TunnelTokenPayload {
		try {
			return jwt.verify(token, TUNNEL_JWT_SECRET, {
				algorithms: ["HS256"],
			}) as TunnelTokenPayload;
		} catch {
			throw new Error("Invalid tunnel token");
		}
	}

	static hasScope(payload: TunnelTokenPayload, requiredScope: string): boolean {
		if (payload.scope.includes("tunnel:*")) return true;
		return payload.scope.includes(requiredScope);
	}
}

export const tunnelJWT = TunnelJWTService;
