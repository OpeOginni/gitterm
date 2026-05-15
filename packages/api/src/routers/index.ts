import { protectedProcedure, publicProcedure, router } from "../index";
import { workspaceRouter } from "./workspace/managment";
import { workspaceOperationsRouter } from "./workspace/operations";
import { internalRouter } from "./internal";
import { githubRouter } from "./github/github";
import { proxyResolverRouter } from "./proxy";
import { agentRouter } from "./agent";
import { userRouter } from "./user/user";
import { deviceRouter } from "./device";
import { adminRouter } from "./admin";
import { agentLoopRouter } from "./agent-loop";
import { modelCredentialsRouter } from "./model-credentials";

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
  agent: agentRouter,
  device: deviceRouter,
  admin: adminRouter,
  agentLoop: agentLoopRouter,
  modelCredentials: modelCredentialsRouter,
  workspaceOps: workspaceOperationsRouter, // Workspace-authenticated operations
});
export type AppRouter = typeof appRouter;

export { listenerRouter, type ListenerRouter } from "./listener";

export { proxyResolverRouter };
