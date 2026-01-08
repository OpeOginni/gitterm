import jwt from "jsonwebtoken";
import env from "@gitterm/env/server";

const WORKSPACE_JWT_SECRET =
  env.WORKSPACE_JWT_SECRET || "default-workspace-secret-change-in-production";
const WORKSPACE_JWT_EXPIRY = "2h"; // Workspace tokens valid for 2 hours

export interface WorkspaceTokenPayload {
  workspaceId: string;
  userId: string;
  scope: string[]; // e.g., ['git:fork', 'git:refresh']
  iat: number;
  exp: number;
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
  static generateToken(workspaceId: string, userId: string, scopes: string[] = ["git:*"]): string {
    const payload: Omit<WorkspaceTokenPayload, "iat" | "exp"> = {
      workspaceId,
      userId,
      scope: scopes,
    };

    return jwt.sign(payload, WORKSPACE_JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: WORKSPACE_JWT_EXPIRY,
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
        throw new Error("Workspace token expired");
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error("Invalid workspace token");
      }
      throw new Error("Token verification failed");
    }
  }

  /**
   * Check if token has required scope
   */
  static hasScope(payload: WorkspaceTokenPayload, requiredScope: string): boolean {
    // Check for wildcard scope
    if (payload.scope.includes("git:*")) {
      return true;
    }

    // Check for exact scope match
    return payload.scope.includes(requiredScope);
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
