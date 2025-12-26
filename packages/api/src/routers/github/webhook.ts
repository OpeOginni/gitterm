import z from "zod";
import { protectedProcedure, publicProcedure, router } from "../../index";
import { githubAppService } from "../../service/github";
import { TRPCError } from "@trpc/server";
import { db, eq } from "@gitterm/db";
import { workspaceGitConfig, githubAppInstallation } from "@gitterm/db/schema/integrations";

export const githubWebhookRouter = router({
  /**
   * Webhook endpoint for GitHub App events
   * Handles installation/uninstallation events
   */
  webhook: publicProcedure
    .input(
      z.object({
        action: z.string(),
        installation: z.object({
          id: z.number(),
          account: z.object({
            id: z.number(),
            login: z.string(),
            type: z.string(),
          }),
          repository_selection: z.string().optional(),
        }),
        sender: z.object({
          id: z.number(),
          login: z.string(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { action, installation } = input;

        if (action === "deleted") {
          // Handle app uninstallation
          const [existingInstallation] = await db
            .select()
            .from(githubAppInstallation)
            .where(
              eq(
                githubAppInstallation.installationId,
                installation.id.toString()
              )
            );

          if (existingInstallation) {
            await githubAppService.removeInstallation(
              existingInstallation.userId,
              installation.id.toString()
            );
          }
        } else if (action === "suspend") {
          // Handle app suspension
          await db
            .update(githubAppInstallation)
            .set({
              suspended: true,
              suspendedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              eq(
                githubAppInstallation.installationId,
                installation.id.toString()
              )
            );
        } else if (action === "unsuspend") {
          // Handle app unsuspension
          await db
            .update(githubAppInstallation)
            .set({
              suspended: false,
              suspendedAt: null,
              updatedAt: new Date(),
            })
            .where(
              eq(
                githubAppInstallation.installationId,
                installation.id.toString()
              )
            );
        }

        return {
          success: true,
          message: `Webhook processed: ${action}`,
        };
      } catch (error) {
        console.error("Failed to process GitHub webhook:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process webhook",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),
});
