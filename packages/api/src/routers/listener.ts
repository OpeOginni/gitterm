import { router } from "../index";
import { railwayWebhookRouter } from "./railway/webhook";
import { githubWebhookRouter } from "./github/webhook";
import { workspaceEventsRouter } from "./workspace/events";
import { agentLoopWebhookRouter } from "./agent-loop/webhook";
import { e2bWebhookRouter } from "./e2b/webhook";

export const listenerRouter = router({
  railway: railwayWebhookRouter,
  e2b: e2bWebhookRouter,
  github: githubWebhookRouter,
  workspace: workspaceEventsRouter,
  agentLoop: agentLoopWebhookRouter,
});

export type ListenerRouter = typeof listenerRouter;
