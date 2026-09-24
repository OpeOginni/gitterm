import { publicProcedure, router } from "../index";
import { workspaceRouter } from "./workspace/managment";
import { workspaceOperationsRouter } from "./workspace/operations";
import { internalRouter } from "./internal";
import { githubRouter } from "./github/github";
import { githubPatRouter } from "./github/pat";
import { proxyResolverRouter } from "./proxy";
import { agentRouter } from "./agent";
import { userRouter } from "./user/user";
import { deviceRouter } from "./device";
import { adminRouter } from "./admin";
import { modelCredentialsRouter } from "./model-credentials";
import { anonRouter } from "./anon";
import { apiTokensRouter } from "./api-tokens";
import { runRouter } from "./run";
import { googleCloudRouter } from "./google-cloud";
import { integrationsRouter } from "./integrations";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  user: userRouter,
  workspace: workspaceRouter,
  internal: internalRouter,
  github: githubRouter,
  githubPat: githubPatRouter,
  agent: agentRouter,
  device: deviceRouter,
  admin: adminRouter,
  modelCredentials: modelCredentialsRouter,
  workspaceOps: workspaceOperationsRouter, // Workspace-authenticated operations
  anon: anonRouter,
  apiTokens: apiTokensRouter,
  run: runRouter,
  googleCloud: googleCloudRouter,
  integrations: integrationsRouter,
});
export type AppRouter = typeof appRouter;

export { listenerRouter, type ListenerRouter } from "./listener";

export { proxyResolverRouter };
