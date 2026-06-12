import z from "zod";
import { Webhook } from "svix";
import { daytonaWebhookProcedure, router } from "../../index";
import { TRPCError } from "@trpc/server";
import { WORKSPACE_EVENTS } from "../../events/workspace";
import { getInternalClient } from "../../client";

// Daytona delivers webhooks via Svix. Payloads are flat JSON objects with a
// shared `event` + `timestamp`, plus event-specific fields.
// See https://www.daytona.io/docs/en/webhooks/
//
// sandbox.state.updated:  { event, timestamp, id, organizationId, oldState, newState, updatedAt }
export const daytonaWebhookEvent = z.enum([
  "sandbox.created",
  "sandbox.state.updated",
]);

// Full set of Daytona sandbox states (mirrors @daytonaio/api-client SandboxState).
export const daytonaSandboxState = z.enum([
  "creating",
  "restoring",
  "destroyed",
  "destroying",
  "started",
  "stopped",
  "starting",
  "stopping",
  "error",
  "build_failed",
  "pending_build",
  "building_snapshot",
  "unknown",
  "pulling_snapshot",
  "archived",
  "archiving",
  "resizing",
  "snapshotting",
]);

export type DaytonaSandboxState = z.infer<typeof daytonaSandboxState>;

export const daytonaWebhookSchema = z.looseObject({
  event: daytonaWebhookEvent,
  timestamp: z.string(),
  id: z.string(),
  organizationId: z.string().optional(),
  oldState: daytonaSandboxState.optional(),
  newState: daytonaSandboxState.optional(),
  updatedAt: z.string().optional(),
});

export type DaytonaWebhookPayload = z.infer<typeof daytonaWebhookSchema>;

/**
 * Verifies a Daytona (Svix) webhook signature against the raw request body.
 * Throws on failure; returns the verified payload object on success.
 */
export function verifyDaytonaWebhookSignature(
  secret: string,
  rawBody: string,
  headers: {
    webhookId: string;
    webhookTimestamp: string;
    webhookSignature: string;
  },
): unknown {
  const wh = new Webhook(secret);
  return wh.verify(rawBody, {
    "webhook-id": headers.webhookId,
    "webhook-timestamp": headers.webhookTimestamp,
    "webhook-signature": headers.webhookSignature,
  });
}

export const daytonaWebhookRouter = router({
  handleWebhook: daytonaWebhookProcedure
    .input(daytonaWebhookSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const client = getInternalClient();

        // Forward the Svix signature material in the payload (not via HTTP
        // headers) so it survives the internal tRPC hop reliably.
        const result = await client.internal.processDaytonaWebhook.mutate({
          ...input,
          rawBody: ctx.rawBody,
          webhookId: ctx.daytonaWebhookId ?? "",
          webhookTimestamp: ctx.daytonaWebhookTimestamp ?? "",
          webhookSignature: ctx.daytonaWebhookSignature ?? "",
        });

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
        console.error("[daytona-webhook] processing failed", {
          event: input.event,
          id: input.id,
          newState: input.newState,
          error:
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error),
        });

        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process Daytona webhook",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),
});
