import z from "zod";
import { protectedProcedure, router } from "../..";
import { TRPCError } from "@trpc/server";
import { db, eq, and, sql, desc } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import { workspace, volume, usageSession, agentWorkspaceConfig } from "@gitterm/db/schema/workspace";
import { cloudProvider, agentType } from "@gitterm/db/schema/cloud";
import { sendAdminMessage } from "../../utils/discord";
import { closeUsageSession } from "../../utils/metering";
import { getProviderByCloudProviderId } from "../../providers";
import { validateAgentConfig } from "@gitterm/schema";

export const userRouter = router({
    deleteUser: protectedProcedure.mutation(async ({ ctx }) => {
        const userId = ctx.session.user.id;
        if (!userId) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
        }

        try {
            // Get all workspaces for the user
            const userWorkspaces = await db.query.workspace.findMany({
                where: eq(workspace.userId, userId),
                with: {
                    volume: true,
                },
            });

            // Close all open usage sessions and terminate all workspaces
            for (const ws of userWorkspaces) {
                try {
                    // Close usage session if workspace is running or pending
                    if (ws.status === "running" || ws.status === "pending") {
                        await closeUsageSession(ws.id, "manual");
                    }

                    // Get the cloud provider
                    const [provider] = await db
                        .select()
                        .from(cloudProvider)
                        .where(eq(cloudProvider.id, ws.cloudProviderId));

                    if (provider) {
                        // Terminate the workspace via compute provider
                        try {
                            const computeProvider = await getProviderByCloudProviderId(provider.name);
                            await computeProvider.terminateWorkspace(
                                ws.externalInstanceId,
                                ws.persistent && ws.volume ? ws.volume.externalVolumeId : undefined
                            );
                        } catch (error) {
                            // Log but continue - workspace might already be terminated
                            console.error(`Failed to terminate workspace ${ws.id}:`, error);
                        }
                    }

                    // Update workspace status to terminated
                    await db
                        .update(workspace)
                        .set({
                            status: "terminated",
                            stoppedAt: new Date(),
                            terminatedAt: new Date(),
                            updatedAt: new Date(),
                        })
                        .where(eq(workspace.id, ws.id));

                    // Delete volume record if persistent
                    if (ws.persistent && ws.volume) {
                        await db.delete(volume).where(eq(volume.id, ws.volume.id));
                    }
                } catch (error) {
                    // Log error but continue with other workspaces
                    console.error(`Error cleaning up workspace ${ws.id}:`, error);
                }
            }

            // Close any remaining open usage sessions (safety check)
            const openSessions = await db
                .select()
                .from(usageSession)
                .where(
                    and(
                        eq(usageSession.userId, userId),
                        sql`${usageSession.stoppedAt} IS NULL`
                    )
                );

            for (const session of openSessions) {
                try {
                    await closeUsageSession(session.workspaceId, "manual");
                } catch (error) {
                    console.error(`Error closing usage session ${session.id}:`, error);
                }
            }

            // Finally, delete the user (this will cascade delete related records)
            await db.delete(user).where(eq(user.id, userId));

            return { success: true };
        } catch (error) {
            console.error("Error deleting user:", error);
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to delete user account",
                cause: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }),

    addAgentConfiguration: protectedProcedure.input(z.object({
        name: z.string().min(1).max(100),
        agentTypeId: z.string().min(1),
        config: z.record(z.string(), z.any()),
    })).mutation(async ({ ctx, input }) => {
        const userId = ctx.session.user.id;
        if (!userId) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
        }

        const fetchedAgentType = await db.query.agentType.findFirst({
            where: eq(agentType.id, input.agentTypeId),
        });

        if (!fetchedAgentType) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Agent type not found" });
        }

        const validationResult = await validateAgentConfig(fetchedAgentType.name, input.config);

        if (!validationResult.success) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid configuration format", cause: validationResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") });
        }

        const [agentConfiguration] = await db.insert(agentWorkspaceConfig).values({
            userId,
            name: input.name,
            agentTypeId: input.agentTypeId,
            config: input.config,
        }).returning();

        return { success: true, agentConfiguration };
    }),

    updateAgentConfiguration: protectedProcedure.input(z.object({
        id: z.uuid(),
        name: z.string().min(1).max(100).optional(),
        config: z.record(z.string(), z.any()).optional(),
    })).mutation(async ({ ctx, input }) => {
        const userId = ctx.session.user.id;
        if (!userId) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
        }

        // Verify ownership
        const existing = await db.query.agentWorkspaceConfig.findFirst({
            where: and(
                eq(agentWorkspaceConfig.id, input.id),
                eq(agentWorkspaceConfig.userId, userId)
            ),
        });

        if (!existing) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Configuration not found" });
        }

        const fetchedAgentType = await db.query.agentType.findFirst({
            where: eq(agentType.id, existing.agentTypeId),
        });

        if (!fetchedAgentType) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Agent type not found" });
        }
        
        console.log("Validating configuration for agent type:", fetchedAgentType.name);
        const validationResult = await validateAgentConfig(fetchedAgentType.name, input.config);
        console.log("Validation result:", validationResult);

        if (!validationResult.success) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid configuration format", cause: validationResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") });
        }

        const [updated] = await db.update(agentWorkspaceConfig)
            .set({
                ...(input.name && { name: input.name }),
                ...(input.config && { config: input.config }),
                updatedAt: new Date(),
            })
            .where(eq(agentWorkspaceConfig.id, input.id))
            .returning();

        return { success: true, agentConfiguration: updated };
    }),

    listAgentConfigurations: protectedProcedure.query(async ({ ctx }) => {
        const userId = ctx.session.user.id;
        if (!userId) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
        }

        const configurations = await db
            .select({
                id: agentWorkspaceConfig.id,
                name: agentWorkspaceConfig.name,
                agentTypeId: agentWorkspaceConfig.agentTypeId,
                agentTypeName: agentType.name,
                config: agentWorkspaceConfig.config,
                createdAt: agentWorkspaceConfig.createdAt,
                updatedAt: agentWorkspaceConfig.updatedAt,
            })
            .from(agentWorkspaceConfig)
            .leftJoin(agentType, eq(agentWorkspaceConfig.agentTypeId, agentType.id))
            .where(eq(agentWorkspaceConfig.userId, userId))
            .orderBy(desc(agentWorkspaceConfig.updatedAt));

        return { configurations };
    }),

    deleteAgentConfiguration: protectedProcedure.input(z.object({
        id: z.uuid(),
    })).mutation(async ({ ctx, input }) => {
        const userId = ctx.session.user.id;
        if (!userId) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
        }

        // Verify ownership before deleting
        const existing = await db.query.agentWorkspaceConfig.findFirst({
            where: and(
                eq(agentWorkspaceConfig.id, input.id),
                eq(agentWorkspaceConfig.userId, userId)
            ),
        });

        if (!existing) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Configuration not found" });
        }

        await db.delete(agentWorkspaceConfig)
            .where(eq(agentWorkspaceConfig.id, input.id));

        return { success: true };
    }),

    submitFeedback: protectedProcedure.input(z.object({
        feedback: z.string().min(1),
    })).mutation(async ({ ctx, input }) => {
        const userId = ctx.session.user.id;
        const userEmail = ctx.session.user.email;
        if (!userId) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
        }

        try {
            sendAdminMessage(`**Feedback submitted by ${userEmail}:**\n\n${input.feedback}`);
        } catch (error) {
            console.error("Failed to send admin message", { error });
        }
        return { success: true };
    }),
})