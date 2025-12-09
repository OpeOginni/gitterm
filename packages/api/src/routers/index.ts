import { protectedProcedure, publicProcedure, router } from "../index";
import { railwayWebhookRouter } from "./railway/webhook";
import { workspaceRouter } from "./workspace";
import { workspaceEventsRouter } from "./workspace/events";
import { workspaceOperationsRouter } from "./workspace/operations";
import { internalRouter } from "./internal";
import { githubRouter } from "./github/github";
import { githubWebhookRouter } from "./github/webhook";
import { proxyResolverRouter } from "./proxy";

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
	workspace: workspaceRouter,
	internal: internalRouter,
	github: githubRouter,
	workspaceOps: workspaceOperationsRouter, // Workspace-authenticated operations
});
export type AppRouter = typeof appRouter;

export const listenerRouter = router({
	railway: railwayWebhookRouter,
	workspace: workspaceEventsRouter,
	github: githubWebhookRouter,
});
export type ListenerRouter = typeof listenerRouter;

export { proxyResolverRouter };