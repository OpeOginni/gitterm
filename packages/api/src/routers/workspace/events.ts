import z from "zod";
import { listenerProcedure, listenerRouter } from "../../index";
import { db, eq } from "@gitpad/db";
import { workspace } from "@gitpad/db/schema/workspace";
import { TRPCError } from "@trpc/server";
import {
	WORKSPACE_STATUS_EVENT,
	workspaceEventEmitter,
	type WorkspaceStatusEvent,
} from "../../events/workspace";
import { on } from "node:events";

export const workspaceEventsRouter = listenerRouter({
	status: listenerProcedure
		.input(
			z.object({
				workspaceId: z.string(),
			}),
		)
		.subscription(async function* ({ input, signal, ctx }) {
			const [existing] = await db.select().from(workspace).where(eq(workspace.id, input.workspaceId));

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Workspace not found",
				});
			}

			if (existing.userId !== ctx.session.user.id) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to access this workspace",
				});
			}

			yield {
				workspaceId: existing.id,
				status: existing.status,
				updatedAt: existing.updatedAt,
				userId: ctx.session.user.id,
				workspaceDomain: existing.domain,
			} satisfies WorkspaceStatusEvent;

			const iterable = on(workspaceEventEmitter, WORKSPACE_STATUS_EVENT, {
				signal,
			}) as AsyncIterableIterator<[WorkspaceStatusEvent]>;

			for await (const [payload] of iterable) {
				if (payload.workspaceId !== input.workspaceId) continue;
				if (payload.userId !== ctx.session.user.id) continue;
				yield payload;
			}
		}),
});

