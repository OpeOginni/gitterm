import z from "zod";
import { cloudflareWebhookProcedure, router } from "../..";
import { getInternalClient } from "../../client";
import { TRPCError } from "@trpc/server";

export const agentLoopWebhookSchema = z.object({
    runId: z.uuid(),
    success: z.boolean(),
    sandboxId: z.string().optional(),
    commitSha: z.string().optional(),
    commitMessage: z.string().optional(),
    error: z.string().optional(),
    isComplete: z.boolean().optional(),
    durationSeconds: z.number().optional(),
});

export const agentLoopWebhookRouter = router({
    handleWebhook: cloudflareWebhookProcedure
        .input(agentLoopWebhookSchema)
        .mutation(async ({ input }) => {
            try {
                const client = getInternalClient();

                const result = await client.internal.processAgentLoopCallback.mutate(input);

                return {
                    success: true,
                    message: "Agent Loop callback processed successfully",
                    result,
                };
            } catch (error) {
                if (error instanceof TRPCError) throw error;

                console.error("[listener] Failed to process Agent Loop webhook:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to process webhook",
                    cause: error instanceof Error ? error.message : "Unknown error",
                });
            }
        })
})