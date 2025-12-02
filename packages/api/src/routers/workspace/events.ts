import z from "zod";
import { publicProcedure, router } from "../../index";
import { db, eq } from "@gitpad/db";
import { workspace } from "@gitpad/db/schema/workspace";
import { TRPCError } from "@trpc/server";
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
			const [existing] = await db.select().from(workspace).where(eq(workspace.id, input.workspaceId));

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Workspace not found",
				});
			}

			if (existing.userId !== input.userId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to access this workspace",
				});
			}

			yield {
				workspaceId: existing.id,
				status: existing.status,
				updatedAt: existing.updatedAt,
				userId: existing.userId,
				workspaceDomain: existing.domain,
			} satisfies WorkspaceStatusEvent;

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

