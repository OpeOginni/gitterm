import { router } from "../index";
import { railwayWebhookRouter } from "./railway/webhook";
import { githubWebhookRouter } from "./github/webhook";
import { workspaceEventsRouter } from "./workspace/events";
import { e2bWebhookRouter } from "./e2b/webhook";
import { daytonaWebhookRouter } from "./daytona/webhook";
import { asciiWebhookRouter } from "./ascii/webhook";

export const listenerRouter = router({
  railway: railwayWebhookRouter,
  e2b: e2bWebhookRouter,
  daytona: daytonaWebhookRouter,
  ascii: asciiWebhookRouter,
  github: githubWebhookRouter,
  workspace: workspaceEventsRouter,
});

export type ListenerRouter = typeof listenerRouter;
