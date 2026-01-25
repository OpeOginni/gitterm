import jwt from "jsonwebtoken";
import env from "@gitterm/env/tunnel-proxy";

const DEFAULT_TUNNEL_SECRET = "default-tunnel-secret-change-in-production";
const TUNNEL_JWT_SECRET = env.TUNNEL_JWT_SECRET || DEFAULT_TUNNEL_SECRET;

if (!env.TUNNEL_JWT_SECRET && env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
  throw new Error("TUNNEL_JWT_SECRET is required outside development/test");
}

if (!env.TUNNEL_JWT_SECRET) {
  console.warn("[TUNNEL-PROXY] Using default tunnel JWT secret (development only)");
}

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
