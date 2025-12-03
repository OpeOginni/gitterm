import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

// Internal service API key for service-to-service communication
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

export const t = initTRPC.context<Context>().create({
	sse: {
		maxDurationMs: 5 * 60 * 1_000, // 5 minutes
		ping: {
		  enabled: true,
		  intervalMs: 3_000,
		},
		client: {
		  reconnectAfterInactivityMs: 5_000,
		},
	}
});

export const router = t.router;

export const publicProcedure = t.procedure;

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