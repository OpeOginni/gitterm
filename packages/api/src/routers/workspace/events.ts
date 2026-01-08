import z from "zod";
import { publicProcedure, router } from "../../index";
import { TRPCError } from "@trpc/server";
import { getInternalClient } from "../../client/internal";
import {
  WORKSPACE_STATUS_EVENT,
  workspaceEventEmitter,
  type WorkspaceStatusEvent,
} from "../../events/workspace";
import { on } from "node:events";

export const workspaceEventsRouter = router({
  status: publicProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        userId: z.string(),
      }),
    )
    .subscription(async function* ({ input, signal }) {
      // Validate workspace access via server's internal API
      const client = getInternalClient();

      let initialState: WorkspaceStatusEvent;
      try {
        const response = await client.internal.validateWorkspaceAccess.query({
          workspaceId: input.workspaceId,
          userId: input.userId,
        });

        // Convert string date back to Date object (tRPC JSON serialization)
        initialState = {
          ...response,
          updatedAt: new Date(response.updatedAt),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        // Handle tRPC client errors
        const trpcError = error as { data?: { code?: string }; message?: string };
        if (trpcError.data?.code === "NOT_FOUND") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workspace not found",
          });
        }
        if (trpcError.data?.code === "UNAUTHORIZED") {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You are not authorized to access this workspace",
          });
        }

        console.error("[listener] Failed to validate workspace access:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to validate workspace access",
        });
      }

      // Yield initial state
      yield initialState;

      // Listen for status updates
      const iterable = on(workspaceEventEmitter, WORKSPACE_STATUS_EVENT, {
        signal,
      }) as AsyncIterableIterator<[WorkspaceStatusEvent]>;

      for await (const [payload] of iterable) {
        if (payload.workspaceId !== input.workspaceId) continue;
        if (payload.userId !== input.userId) continue;
        yield payload;
      }
    }),
});
