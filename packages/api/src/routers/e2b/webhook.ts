import z from "zod";
import { e2bWebhookProcedure, publicProcedure, router } from "../../index";
import { TRPCError } from "@trpc/server";
import { WORKSPACE_EVENTS } from "../../events/workspace";
import { getInternalClient } from "../../client";
import crypto from "crypto";

// {
//     "version": "v1",
//     "id": "<UUID>",
//     "type": "sandbox.lifecycle.created",
//     "eventData": null,
//     "sandboxBuildId": "<UUID>",
//     "sandboxExecutionId": "<UUID>",
//     "sandboxId": "<SANDBOX_ID>",
//     "sandboxTeamId": "<UUID>",
//     "sandboxTemplateId": "<TEMPLATE_ID>",
//     "timestamp": "<ISO_8601_TIMESTAMP>"
//   }

export const webhookType = z.enum([
  "sandbox.lifecycle.created",
  "sandbox.lifecycle.paused",
  "sandbox.lifecycle.resumed",
  "sandbox.lifecycle.updated",
  "sandbox.lifecycle.killed",
]);

export const e2bWebhookSchema = z.object({
  version: z.string(),
  id: z.uuid(),
  type: webhookType,
  eventData: z.any(),
  sandboxBuildId: z.uuid(),
  sandboxExecutionId: z.uuid(),
  sandboxId: z.string(),
  sandboxTeamId: z.uuid(),
  sandboxTemplateId: z.string(),
  timestamp: z.string(),
});

export const e2bWebhookRouter = router({
  handleWebhook: e2bWebhookProcedure.input(e2bWebhookSchema).mutation(async ({ input, ctx }) => {
    const signature = ctx.e2bSignature ?? undefined;
    try {
      const client = getInternalClient({ "e2b-signature": signature });
      const result = await client.internal.processE2bWebhook.mutate(input);

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

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to process webhook",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),
});

export function verifyE2BWebhookSignature(
  secret: string,
  payload: string,
  payloadSignature: string,
) {
  const expectedSignatureRaw = crypto
    .createHash("sha256")
    .update(secret + payload)
    .digest("base64");
  const expectedSignature = expectedSignatureRaw.replace(/=+$/, "");
  return expectedSignature == payloadSignature;
}
