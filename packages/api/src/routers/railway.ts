import z from "zod";
import { protectedProcedure, router } from "../index";
import { railway } from "../service/railway/railway";
import { db, eq, and } from "@gitpad/db";
import { workspace, agentWorkspaceConfig, workspaceEnvironmentVariables } from "@gitpad/db/schema/workspace";
import { image } from "@gitpad/db/schema/cloud";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "crypto";

const PROJECT_ID = process.env.RAILWAY_PROJECT_ID;

if (!PROJECT_ID) {
  throw new Error("RAILWAY_PROJECT_ID is not set");
}

export const railwayRouter = router({
  // Create a new service from a GitHub repo
  createService: protectedProcedure
    .input(
      z.object({
        name: z.string().optional(),
        repo: z.string(), // e.g. "railwayapp-templates/django",
        imageId: z.string(),
        agentTypeId: z.string(),
        cloudProviderId: z.string(),
        region: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      console.log("createService input:", input);
      const userId = ctx.session.user.id;
      const workspaceId = randomUUID();
      const subdomain = `ws-${workspaceId}`;

      try {
        // Fetch image details
        const [imageRecord] = await db
          .select()
          .from(image)
          .where(eq(image.id, input.imageId));

        if (!imageRecord) {
           throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid image ID" });
        }

        // Fetch user's agent configuration
        const [agentConfig] = await db
          .select()
          .from(agentWorkspaceConfig)
          .where(
            and(
              eq(agentWorkspaceConfig.userId, userId),
              eq(agentWorkspaceConfig.agentTypeId, input.agentTypeId)
            )
          );

        // Fetch user's workspace environment variables
        const [userWorkspaceEnvironmentVariables] = await db
          .select()
          .from(workspaceEnvironmentVariables)
          .where(
            and(
              eq(workspaceEnvironmentVariables.userId, userId),
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId)
            )
          );

        const DEFAULT_DOCKER_ENV_VARS = {
          "REPO_URL": input.repo,
          "OPENCODE_CONFIG_BASE64": agentConfig ? Buffer.from(JSON.stringify(agentConfig.config)).toString("base64") : undefined,
          ...(userWorkspaceEnvironmentVariables ? userWorkspaceEnvironmentVariables.environmentVariables as any : {}),
        }

        const { serviceCreate } = await railway.ServiceCreate({
          input: {
            projectId: PROJECT_ID,
            name: subdomain, // Use subdomain as service name for predictable internal DNS
            source: {
              image: imageRecord.imageId,
            },
            variables: DEFAULT_DOCKER_ENV_VARS
          },
        }).catch((error) => {
          console.error("Railway API Error:", error);
          throw new Error(`Railway API Error: ${error.message}`);
        });

        // Construct internal backend URL (assuming Railway Private Networking)
        // Service name is used as the hostname. Port 7681 is ttyd default.
        const backendUrl = `http://${subdomain}.railway.internal:7681`;

        const [newWorkspace] = await db.insert(workspace).values({
          id: workspaceId,
          userId,
          externalInstanceId: serviceCreate.id,
          imageId: input.imageId,
          cloudProviderId: input.cloudProviderId,
          region: input.region,
          repositoryUrl: input.repo,
          subdomain: subdomain,
          backendUrl: backendUrl,
          domain: `${subdomain}.gitterm.dev`, // This domain will be handled by the wildcard proxy
          status: "pending",
          startAt: new Date(serviceCreate.createdAt),
        }).returning();

        return {
          workspace: newWorkspace
        };
      } catch (error) {
        console.error("createService failed:", error);
        // Throw a user-friendly error to the client
        if (error instanceof TRPCError) throw error;
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create workspace. Please try again later.",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Delete a service
  deleteService: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const [fetchedWorkspace] = await db.select().from(workspace).where(and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)));

      if (!fetchedWorkspace) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }
      
      const { serviceDelete } = await railway.ServiceDelete({ id: fetchedWorkspace.externalInstanceId });

      await db.update(workspace).set({ status: "terminated", endAt: new Date() }).where(eq(workspace.id, input.workspaceId));
      return {
        workspace: fetchedWorkspace,
        serviceDelete
      };
    }),

  // Update a service
  updateService: protectedProcedure
    .input(
      z.object({
        serviceId: z.string(),
        name: z.string().optional(),
        icon: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await railway.ServiceUpdate({
        id: input.serviceId,
        input: {
          name: input.name,
          icon: input.icon,
        },
      });
      return result.serviceUpdate;
    }),

  // Redeploy a deployment
  redeployDeployment: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .mutation(async ({ input }) => {
      const result = await railway.DeploymentRedeploy({ id: input.deploymentId });
      return result.deploymentRedeploy;
    }),

  // Get current user info
  me: protectedProcedure.query(async () => {
    const result = await railway.Me();
    return result.me;
  }),

  // Get a single project with its services
  getProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const result = await railway.Project({ id: input.projectId });
      return result.project;
    }),

  // List all projects
  listProjects: protectedProcedure.query(async () => {
    const result = await railway.Projects();
    return result.projects.edges.map((e) => e.node);
  }),

  // Get a single service
  getService: protectedProcedure
    .input(z.object({ serviceId: z.string() }))
    .query(async ({ input }) => {
      const result = await railway.Service({ id: input.serviceId });
      return result.service;
    }),

  // List environments for a project
  listEnvironments: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const result = await railway.Environments({ projectId: input.projectId });
      return result.environments.edges.map((e) => e.node);
    }),

  // List deployments for a service
  listDeployments: protectedProcedure
    .input(
      z.object({
        serviceId: z.string(),
        limit: z.number().optional().default(10),
      })
    )
    .query(async ({ input }) => {
      const result = await railway.Deployments({
        input: { serviceId: input.serviceId },
        first: input.limit,
      });
      return result.deployments.edges.map((e) => e.node);
    }),
});
