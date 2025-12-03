import { protectedProcedure, publicProcedure, router } from "../index";
import { railwayRouter } from "./railway/railway";
import { railwayWebhookRouter } from "./railway/webhook";
import { workspaceRouter } from "./workspace";
import { workspaceEventsRouter } from "./workspace/events";
import { internalRouter } from "./internal";

export const appRouter = router({
	healthCheck: publicProcedure.query(() => {
		return "OK";
	}),
	privateData: protectedProcedure.query(({ ctx }) => {
		return {
			message: "This is private",
			user: ctx.session.user,
		};
	}),
	railway: railwayRouter,
	workspace: workspaceRouter,
	internal: internalRouter,
});
export type AppRouter = typeof appRouter;

export const listenerRouter = router({
	railway: railwayWebhookRouter,
	workspace: workspaceEventsRouter,
});
export type ListenerRouter = typeof listenerRouter;