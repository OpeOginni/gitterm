import z from "zod";
import { publicProcedure, router } from "../../index";
import { TRPCError } from "@trpc/server";
import { createInternalClient } from "../../client/internal";
import env from "@gitterm/env/listener";

// Create internal client for calling server
const getClient = () => {
  const serverUrl = env.SERVER_URL;
  const apiKey = env.INTERNAL_API_KEY;
  
  if (!serverUrl || !apiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Listener not configured: SERVER_URL or INTERNAL_API_KEY missing",
    });
  }
  
  return createInternalClient(serverUrl, apiKey);
};

// Railway webhook schema - matches server's expected input
const deploymentStatus = z.enum(["BUILDING", "DEPLOYING", "FAILED", "SUCCESS"]);
const webhookType = z.enum(["Deployment.created", "Deployment.deploying", "Deployment.deployed", "Deployment.failed"]);
const webhookSeverity = z.enum(["INFO", "WARNING", "ERROR"]);

const railwayWebhookSchema = z.object({
  type: webhookType,
  severity: webhookSeverity,
  timestamp: z.string(),
  resource: z.object({
    workspace: z.object({
        id: z.string(),
        name: z.string(),
    }).optional(),
    project: z.object({
        id: z.string(),
        name: z.string(),
    }).optional(),
    environment: z.object({
        id: z.string(),
        name: z.string(),
        isEphemeral: z.boolean(),
    }).optional(),
    service: z.object({
        id: z.string(),
        name: z.string()
    }).optional(),
    deployment: z.object({
        id: z.string().optional(),
    }).optional(),
  }).passthrough(),
  details: z.object({
    id: z.string().optional(),
    source: z.string().optional(),
    status: deploymentStatus.optional(),
    builder: z.string().optional(),
    providers: z.string().optional(),
    serviceId: z.string().optional(),
    imageSource: z.string().optional(),
    branch: z.string().optional(),
    commitHash: z.string().optional(),
    commitAuthor: z.string().optional(),
    commitMessage: z.string().optional(),
  }).passthrough(),
});


export const railwayWebhookRouter = router({
  handleWebhook: publicProcedure.input(railwayWebhookSchema).mutation(async ({ input }) => {
    try {
      const client = getClient();
      const result = await client.internal.processRailwayWebhook.mutate(input);
      return result;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      
      console.error("[listener] Failed to process Railway webhook:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to process webhook",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),
});

export type RailwayWebhookRouter = typeof railwayWebhookRouter;
