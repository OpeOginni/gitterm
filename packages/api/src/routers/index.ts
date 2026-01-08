import { protectedProcedure, publicProcedure, router } from "../index";
import { railwayWebhookRouter } from "./railway/webhook";
import { githubWebhookRouter } from "./github/webhook";
import { workspaceRouter } from "./workspace/managment";
import { workspaceEventsRouter } from "./workspace/events";
import { workspaceOperationsRouter } from "./workspace/operations";
import { internalRouter } from "./internal";
import { githubRouter } from "./github/github";
import { proxyResolverRouter } from "./proxy";
import { tunnelRouter } from "./tunnel";
import { agentRouter } from "./agent";
import { userRouter } from "./user/user";
import { deviceRouter } from "./device";
import { adminRouter } from "./admin";
import { agentLoopRouter } from "./agent-loop";
import { agentLoopWebhookRouter } from "./agent-loop/webhook";

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
	user: userRouter,
	workspace: workspaceRouter,
	internal: internalRouter,
	github: githubRouter,
	tunnel: tunnelRouter,
	agent: agentRouter,
	device: deviceRouter,
	admin: adminRouter,
	agentLoop: agentLoopRouter,
	workspaceOps: workspaceOperationsRouter, // Workspace-authenticated operations
});
export type AppRouter = typeof appRouter;

export const listenerRouter = router({
	railway: railwayWebhookRouter,
	github: githubWebhookRouter,
	workspace: workspaceEventsRouter,
	agentLoop: agentLoopWebhookRouter,
});

export type ListenerRouter = typeof listenerRouter;

export { proxyResolverRouter };