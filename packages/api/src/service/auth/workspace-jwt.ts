import jwt from "jsonwebtoken";
import env from "@gitterm/env/server";

function getWorkspaceJwtSecret(): string {
  const secret =
    env.WORKSPACE_JWT_SECRET ??
    env.INTERNAL_API_KEY ??
    (env.NODE_ENV === "production" ? undefined : "gitterm-development-workspace-secret");
  if (!secret) throw new Error("WORKSPACE_JWT_SECRET is required in production");
  return secret;
}

const WORKSPACE_JWT_SECRET = getWorkspaceJwtSecret();
export interface WorkspaceTokenPayload {
  workspaceId: string;
  userId: string;
  scope: string[]; // e.g., ['workspace:read', 'port:*']
  iat: number;
  exp?: number;
}

/**
 * Workspace JWT Service
 * Generates and validates workspace-specific JWT tokens
 * Eliminates the need for shared INTERNAL_API_KEY
 */
export class WorkspaceJWTService {
  /**
   * Generate a workspace-scoped JWT token
   */
  static generateToken(
    workspaceId: string,
    userId: string,
    scopes: string[] = ["workspace:read"],
  ): string {
    // Workspace tokens are durable because provider environments cannot be
    // rotated consistently. Their scopes are narrow and routes revoke access
    // by checking workspace ownership and terminal status.
    return jwt.sign({ workspaceId, userId, scope: scopes }, WORKSPACE_JWT_SECRET, {
      algorithm: "HS256",
    });
  }

  /**
   * Verify and decode a workspace JWT token
   */
  static verifyToken(token: string): WorkspaceTokenPayload {
    try {
      const decoded = jwt.verify(token, WORKSPACE_JWT_SECRET, {
        algorithms: ["HS256"],
      }) as WorkspaceTokenPayload;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error("Workspace token expired", { cause: error });
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error("Invalid workspace token", { cause: error });
      }
      throw new Error("Token verification failed", { cause: error });
    }
  }

  /**
   * Check if token has required scope
   */
  static hasScope(payload: WorkspaceTokenPayload, requiredScope: string): boolean {
    if (payload.scope.includes(requiredScope) || payload.scope.includes("*")) return true;

    const separator = requiredScope.indexOf(":");
    if (separator === -1) return false;
    return payload.scope.includes(`${requiredScope.slice(0, separator)}:*`);
  }

  /**
   * Validate that workspace belongs to user
   */
  static validateOwnership(
    payload: WorkspaceTokenPayload,
    workspaceId: string,
    userId: string,
  ): boolean {
    return payload.workspaceId === workspaceId && payload.userId === userId;
  }
}

export const workspaceJWT = WorkspaceJWTService;
