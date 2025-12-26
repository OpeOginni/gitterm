import z from "zod";
import { publicProcedure, router } from "../../index";
import { workspace } from "@gitterm/db/schema/workspace";
import { and, db, eq } from "@gitterm/db";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { TRPCError } from "@trpc/server";
import { WORKSPACE_EVENTS } from "../../events/workspace";

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
  }).loose(),
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
  }).loose(),
});


export const railwayWebhookRouter = router({
  handleWebhook: publicProcedure.input(railwayWebhookSchema).mutation(async ({ input }) => {
    try {
      if (input.type === "Deployment.deployed" && input.details?.serviceId) {
          const serviceId = input.details.serviceId;

          const [railwayProvider] = await db.select().from(cloudProvider)
          .where(eq(cloudProvider.name, "Railway"))

          if(!railwayProvider) {
              throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: "Railway Webhook Error",
                  cause: "Failed to get Railway Provider from Database"
                });
          }

        const updatedWorkspaces = await db.update(workspace).set({
            status: "running",
            updatedAt: new Date(input.timestamp),
            externalRunningDeploymentId: input.resource.deployment?.id
        }).where(and(
          eq(workspace.cloudProviderId, railwayProvider.id),
          eq(workspace.externalInstanceId, serviceId),
          eq(workspace.status, "pending")
        )).returning({
          id: workspace.id,
          status: workspace.status,
          updatedAt: workspace.updatedAt,
          userId: workspace.userId,
          workspaceDomain: workspace.domain
        });

        updatedWorkspaces.forEach((record) => {
          WORKSPACE_EVENTS.emitStatus({
            workspaceId: record.id,
            status: record.status,
            updatedAt: record.updatedAt,
            userId: record.userId,
            workspaceDomain: record.workspaceDomain
          });
        });

      } else {
        return;
      }
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to update workspace status",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),
});

export type RailwayWebhookRouter = typeof railwayWebhookRouter;