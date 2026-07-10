import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";
import { workspaceJWT } from "./service/auth/workspace-jwt";
import env from "@gitterm/env/server";
import { verifyApiToken } from "./service/auth/api-token";
import { db, eq } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";

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

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (ctx.session) {
    return next({
      ctx: {
        ...ctx,
        session: ctx.session,
        authMethod: "session" as const,
      },
    });
  }

  const token = ctx.bearerToken;
  if (token) {
    // User API tokens (`gt_...`): DB-backed and revocable, created from the
    // web UI (Settings -> Account -> API tokens) or the CLI device-code flow.
    const verified = await verifyApiToken(token);

    if (verified) {
      const [apiUser] = await db.select().from(user).where(eq(user.id, verified.userId)).limit(1);

      if (apiUser) {
        return next({
          ctx: {
            ...ctx,
            session: { user: apiUser } as unknown as NonNullable<Context["session"]>,
            authMethod: "apiToken" as const,
          },
        });
      }
    }
  }

  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "Authentication required",
    cause: "No session or valid API token",
  });
});

/**
 * Session-only procedure - requires a browser session (better-auth cookie) and
 * never accepts user API tokens. Use for security-sensitive routes where a
 * long-lived API token must not be sufficient, e.g. approving device-code
 * logins (which mints new API tokens) or admin operations.
 */
export const sessionProcedure = t.procedure.use(({ ctx, next }) => {
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
      authMethod: "session" as const,
    },
  });
});

/**
 * Admin procedure - requires authenticated user with admin role.
 * Built on sessionProcedure: admin actions require a browser session and are
 * not reachable with a user API token.
 */
export const adminProcedure = sessionProcedure.use(({ ctx, next }) => {
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

export const e2bWebhookProcedure = t.procedure.use(({ ctx, next }) => {
  const e2bSignature = ctx.e2bSignature;

  if (!e2bSignature) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "GitHub e2b-signature required",
    });
  }

  return next({ ctx });
});

export const daytonaWebhookProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.daytonaWebhookId || !ctx.daytonaWebhookTimestamp || !ctx.daytonaWebhookSignature) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Daytona webhook signature headers required",
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
