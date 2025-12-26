import jwt from "jsonwebtoken";
import env from "@gitterm/env/server";

const AGENT_JWT_SECRET = env.AGENT_JWT_SECRET || "default-agent-secret-change-in-production";
const AGENT_JWT_EXPIRY = "30d";

export interface AgentTokenPayload {
	userId: string;
	scope: string[];
	iat: number;
	exp: number;
}

export class AgentJWTService {
	static generateToken(params: { userId: string; scopes?: string[] }): string {
		const payload: Omit<AgentTokenPayload, "iat" | "exp"> = {
			userId: params.userId,
			scope: params.scopes ?? ["agent:*"],
		};

		return jwt.sign(payload, AGENT_JWT_SECRET, {
			algorithm: "HS256",
			expiresIn: AGENT_JWT_EXPIRY,
		});
	}

	static verifyToken(token: string): AgentTokenPayload {
		try {
			return jwt.verify(token, AGENT_JWT_SECRET, {
				algorithms: ["HS256"],
			}) as AgentTokenPayload;
		} catch {
			throw new Error("Invalid agent token");
		}
	}

	static hasScope(payload: AgentTokenPayload, requiredScope: string): boolean {
		if (payload.scope.includes("agent:*")) return true;
		return payload.scope.includes(requiredScope);
	}
}

export const agentJWT = AgentJWTService;
