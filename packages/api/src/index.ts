import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";
import { workspaceJWT } from "./service/auth/workspace-jwt";
import env from "@gitterm/env/server";
import { cliJWT } from "./service/auth/cli/cli-jwt";

// Internal service API key for service-to-service communication
const INTERNAL_API_KEY = env.INTERNAL_API_KEY;

export const t = initTRPC.context<Context>().create({
  sse: {
    maxDurationMs: 5 * 60 * 1_000, // 5 minutes
    ping: {
      enabled: true,
      // Keep connections alive aggressively in dev/proxies to avoid EventSource reconnect loops.
      intervalMs: 1_000,
    },
    client: {
      // The client will auto-reconnect if it doesn't see any events (including pings) in this window.
      reconnectAfterInactivityMs: 20_000,
    },
  },
});

export const router = t.router;

export const publicProcedure = t.procedure;

// Export AppRouter type for clients
export type { AppRouter } from "./routers/index";

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

/**
 * Admin procedure - requires authenticated user with admin role
 */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  // Check if user has admin role
  const userRole = (ctx.session.user as any).role;

  if (userRole !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

/**
 * Internal procedure for service-to-service communication
 * Requires INTERNAL_API_KEY in X-Internal-Key header
 */
export const internalProcedure = t.procedure.use(({ ctx, next }) => {
  const internalKey = ctx.internalApiKey;

  if (!INTERNAL_API_KEY) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal API key not configured",
    });
  }

  if (!internalKey || internalKey !== INTERNAL_API_KEY) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid internal API key",
    });
  }

  return next({ ctx });
});

export const githubWebhookProcedure = t.procedure.use(({ ctx, next }) => {
  const githubEvent = ctx.githubEvent;
  const githubInstallationTargetId = ctx.githubInstallationTargetId;

  const githubXHubSignature256 = ctx.githubXHubSignature256;

  if (!githubXHubSignature256) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "GitHub X-Hub-Signature-256 required",
    });
  }

  if (!githubEvent) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "GitHub event required",
    });
  }

  if (!githubInstallationTargetId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "GitHub installation target ID required",
    });
  }

  return next({ ctx });
});

export const cloudflareWebhookProcedure = t.procedure.use(({ ctx, next }) => {
  const token = ctx.bearerToken;

  if (!token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Bearer token required",
    });
  }

  return next({ ctx });
});

/**
 * Workspace-authenticated procedure
 * Uses JWT tokens for workspace-to-backend communication
 * Validates token and extracts workspace/user info
 *
 * NOTE: This is separate from user session authentication
 * - User sessions: Cookie-based (better-auth)
 * - Workspace auth: Bearer token in Authorization header
 */
export const workspaceAuthProcedure = t.procedure.use(({ ctx, next }) => {
  const token = ctx.bearerToken;

  if (!token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Workspace authentication token required",
    });
  }

  // Ensure this is NOT a user session request
  // Workspace requests should not have user sessions
  if (ctx.session) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Workspace endpoints cannot be called with user session. Use workspace JWT token only.",
    });
  }

  try {
    const payload = workspaceJWT.verifyToken(token);

    return next({
      ctx: {
        ...ctx,
        workspaceAuth: payload,
      },
    });
  } catch (error) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: error instanceof Error ? error.message : "Invalid workspace token",
    });
  }
});


export const cliAuthProcedure = t.procedure.use(({ ctx, next }) => {
  const token = ctx.bearerToken;

  if (!token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "CLI authentication token required",
    });
  }

  try {
    const payload = cliJWT.verifyToken(token);

    return next({
      ctx: {
        ...ctx,
        cliAuth: payload,
      },
    });
  } catch (error) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: error instanceof Error ? error.message : "Invalid CLI token",
    });
  }
});
