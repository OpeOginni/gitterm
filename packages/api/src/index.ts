import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const listenerT = initTRPC.context<Context>().create({
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
export const listenerRouter = listenerT.router;

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

export const listenerProcedure = listenerT.procedure.use(({ ctx, next }) => {
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