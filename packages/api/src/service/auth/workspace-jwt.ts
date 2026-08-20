import jwt from "jsonwebtoken";
import env from "@gitterm/env/server";
import { randomUUID } from "crypto";

function getWorkspaceJwtSecret(): string {
  const secret =
    env.WORKSPACE_JWT_SECRET ??
    (env.NODE_ENV === "production" ? undefined : "gitterm-development-workspace-secret");
  if (!secret) throw new Error("WORKSPACE_JWT_SECRET is required in production");
  return secret;
}

const WORKSPACE_JWT_SECRET = getWorkspaceJwtSecret();
const WORKSPACE_TOKEN_ISSUER = "gitterm";
const WORKSPACE_TOKEN_AUDIENCE = "gitterm-workspace-api";
const WORKSPACE_TOKEN_LIFETIME = "365d";

export type WorkspaceTokenPurpose = "workspace" | "agent" | "setup";

export interface WorkspaceTokenPayload {
  workspaceId: string;
  userId: string;
  scope: string[];
  purpose: WorkspaceTokenPurpose;
  iss: string;
  aud: string | string[];
  jti: string;
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
  static generateToken(
    workspaceId: string,
    userId: string,
    scopes: string[],
    purpose: WorkspaceTokenPurpose,
  ): string {
    return jwt.sign({ workspaceId, userId, scope: scopes, purpose }, WORKSPACE_JWT_SECRET, {
      algorithm: "HS256",
      issuer: WORKSPACE_TOKEN_ISSUER,
      audience: WORKSPACE_TOKEN_AUDIENCE,
      jwtid: randomUUID(),
      expiresIn: WORKSPACE_TOKEN_LIFETIME,
    });
  }

  /**
   * Verify and decode a workspace JWT token
   */
  static verifyToken(
    token: string,
    expectedPurpose?: WorkspaceTokenPurpose,
  ): WorkspaceTokenPayload {
    try {
      const decoded = jwt.verify(token, WORKSPACE_JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: WORKSPACE_TOKEN_ISSUER,
        audience: WORKSPACE_TOKEN_AUDIENCE,
      });

      if (!decoded || typeof decoded === "string") throw new Error("Invalid workspace token");
      if (
        typeof decoded.workspaceId !== "string" ||
        !decoded.workspaceId ||
        typeof decoded.userId !== "string" ||
        !decoded.userId ||
        !Array.isArray(decoded.scope) ||
        !decoded.scope.every((scope) => typeof scope === "string") ||
        !["workspace", "agent", "setup"].includes(decoded.purpose) ||
        typeof decoded.jti !== "string" ||
        !decoded.jti ||
        typeof decoded.iat !== "number" ||
        typeof decoded.exp !== "number"
      ) {
        throw new Error("Invalid workspace token claims");
      }

      if (expectedPurpose && decoded.purpose !== expectedPurpose) {
        throw new Error(`Workspace token purpose must be ${expectedPurpose}`);
      }

      return decoded as WorkspaceTokenPayload;
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
