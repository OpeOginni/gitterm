import jwt from "jsonwebtoken";
import env from "@gitterm/env/server";

const CLI_JWT_SECRET = env.CLI_JWT_SECRET || "default-cli-secret-change-in-production";
const CLI_JWT_EXPIRY = "30d";

export interface CLITokenPayload {
  userId: string;
  scope: string[];
  iat: number;
  exp: number;
}

export class CLIJWTService {
  static generateToken(params: { userId: string; scopes?: string[] }): string {
    const payload: Omit<CLITokenPayload, "iat" | "exp"> = {
      userId: params.userId,
      scope: params.scopes ?? ["tunnel:sync:*"],
    };

    return jwt.sign(payload, CLI_JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: CLI_JWT_EXPIRY,
    });
  }

  static verifyToken(token: string): CLITokenPayload {
    try {
      return jwt.verify(token, CLI_JWT_SECRET, {
        algorithms: ["HS256"],
      }) as CLITokenPayload;
    } catch {
      throw new Error("Invalid agent token");
    }
  }

  static hasScope(payload: CLITokenPayload, requiredScope: string): boolean {
    if (payload.scope.includes("tunnel:sync:*")) return true;
    return payload.scope.includes(requiredScope);
  }
}

export const cliJWT = CLIJWTService;
