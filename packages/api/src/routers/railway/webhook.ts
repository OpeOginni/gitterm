import z from "zod";
import { publicProcedure, router } from "../../index";
import { TRPCError } from "@trpc/server";
import { WORKSPACE_EVENTS } from "../../events/workspace";
import { getInternalClient } from "../../client";

// Railway webhook schema - matches server's expected input
export const deploymentStatus = z.enum(["BUILDING", "DEPLOYING", "FAILED", "SUCCESS"]);
export const webhookType = z.enum([
  "Deployment.created",
  "Deployment.deploying",
  "Deployment.deployed",
  "Deployment.failed",
]);
export const webhookSeverity = z.enum(["INFO", "WARNING", "ERROR"]);

export const railwayWebhookSchema = z.object({
  type: webhookType,
  severity: webhookSeverity,
  timestamp: z.string(),
  resource: z
    .object({
      workspace: z
        .object({
          id: z.string(),
          name: z.string(),
        })
        .optional(),
      project: z
        .object({
          id: z.string(),
          name: z.string(),
        })
        .optional(),
      environment: z
        .object({
          id: z.string(),
          name: z.string(),
          isEphemeral: z.boolean(),
        })
        .optional(),
      service: z
        .object({
          id: z.string(),
          name: z.string(),
        })
        .optional(),
      deployment: z
        .object({
          id: z.string().optional(),
        })
        .optional(),
    })
    .loose(),
  details: z
    .object({
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
    })
    .loose(),
});

export const railwayWebhookRouter = router({
  handleWebhook: publicProcedure.input(railwayWebhookSchema).mutation(async ({ input }) => {
    try {
      const client = getInternalClient();
      const result = await client.internal.processRailwayWebhook.mutate(input);
      // The server updated the DB; now emit locally in the listener process so any
      // open SSE subscriptions (`workspace.status`) can yield the update.
      for (const record of result.updated) {
        WORKSPACE_EVENTS.emitStatus({
          workspaceId: record.id,
          status: record.status,
          updatedAt: new Date(record.updatedAt),
          userId: record.userId,
          workspaceDomain: record.workspaceDomain,
        });
      }
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
