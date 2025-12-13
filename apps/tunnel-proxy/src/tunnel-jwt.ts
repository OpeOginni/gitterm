import jwt from "jsonwebtoken";

const TUNNEL_JWT_SECRET = process.env.TUNNEL_JWT_SECRET || "default-tunnel-secret-change-in-production";

export interface TunnelTokenPayload {
	workspaceId: string;
	userId: string;
	subdomain: string;
	scope: string[];
	exposedPorts?: Record<string, number>;
	iat: number;
	exp: number;
}

export const tunnelJWT = {
	verifyToken(token: string): TunnelTokenPayload {
		try {
			return jwt.verify(token, TUNNEL_JWT_SECRET, {
				algorithms: ["HS256"],
			}) as TunnelTokenPayload;
		} catch {
			throw new Error("Invalid tunnel token");
		}
	},
	hasScope(payload: TunnelTokenPayload, requiredScope: string) {
		if (payload.scope.includes("tunnel:*")) return true;
		return payload.scope.includes(requiredScope);
	},
};
