import z from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { asciiWebhookProcedure, router } from "../../index";
import { WORKSPACE_EVENTS } from "../../events/workspace";
import { getInternalClient } from "../../client";

// boat sends account-wide lifecycle events, signed with the endpoint's secret.
// See https://docs.boat.dev/webhooks. The public API names them `sandbox.*` with
// `data.sandbox`; the Box API and its SDK name the same events `box.*` with `data.box`.
const asciiEventType = z.enum([
  "sandbox.ready",
  "sandbox.hydrated",
  "sandbox.error",
  "sandbox.archived",
  "sandbox.degraded",
  "sandbox.recovered",
  "box.ready",
  "box.hydrated",
  "box.error",
  "box.archived",
]);

const asciiSubject = z.looseObject({ id: z.string() });

export const asciiWebhookSchema = z.looseObject({
  id: z.string(),
  type: asciiEventType,
  createdAt: z.iso.datetime(),
  data: z.looseObject({
    sandbox: asciiSubject.optional(),
    box: asciiSubject.optional(),
    previousState: z.string().optional(),
    state: z.string().optional(),
  }),
});

export type AsciiWebhookPayload = z.infer<typeof asciiWebhookSchema>;

/** The box an event is about, under either naming. */
export const asciiWebhookBoxId = (payload: AsciiWebhookPayload) =>
  payload.data.sandbox?.id ?? payload.data.box?.id;

/** Deliveries older (or newer) than this are rejected as replays. */
const MAX_SKEW_SECONDS = 300;

/**
 * Verifies boat's `X-Ascii-Signature` (`v1=` + hex HMAC-SHA256 of
 * `delivery.timestamp.raw_body`) and that the attempt is recent.
 */
export function verifyAsciiWebhookSignature(
  secret: string,
  rawBody: string,
  headers: { delivery: string; timestamp: string; signature: string },
  now = Date.now(),
): boolean {
  const issuedAt = Number(headers.timestamp);
  if (!Number.isFinite(issuedAt) || Math.abs(now / 1000 - issuedAt) > MAX_SKEW_SECONDS) {
    return false;
  }
  const supplied = headers.signature.replace(/^v1=/, "");
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", secret)
    .update(`${headers.delivery}.${headers.timestamp}.`)
    .update(rawBody)
    .digest("hex");
  return timingSafeEqual(Buffer.from(supplied.toLowerCase(), "hex"), Buffer.from(expected, "hex"));
}

export const asciiWebhookRouter = router({
  handleWebhook: asciiWebhookProcedure
    .input(asciiWebhookSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        // Signature material travels in the payload so it survives the internal hop.
        const result = await getInternalClient().internal.processAsciiWebhook.mutate({
          ...input,
          rawBody: ctx.rawBody,
          delivery: ctx.asciiWebhookDelivery ?? "",
          timestamp: ctx.asciiWebhookTimestamp ?? "",
          signature: ctx.asciiWebhookSignature ?? "",
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
        console.error("[boat-webhook] processing failed", {
          event: input.type,
          id: input.id,
          boxId: asciiWebhookBoxId(input),
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process webhook",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),
});
