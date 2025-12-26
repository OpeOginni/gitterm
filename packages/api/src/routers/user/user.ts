import z from "zod";
import { protectedProcedure, router } from "../..";
import { TRPCError } from "@trpc/server";
import { db, eq, and, sql } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import { workspace, volume, usageSession } from "@gitterm/db/schema/workspace";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { sendAdminMessage } from "../../utils/discord";
import { closeUsageSession } from "../../utils/metering";
import { getProviderByCloudProviderId } from "../../providers";

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