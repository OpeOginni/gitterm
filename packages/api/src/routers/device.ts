import z from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../index";
import { DeviceCodeRepository } from "@gitterm/redis";

const deviceRepo = new DeviceCodeRepository();

export const deviceRouter = router({
	/**
	 * Approve or deny a device code authorization request
	 * 
	 * This is used by the web UI when a user wants to approve/deny
	 * a CLI device that's trying to authenticate via the device code flow.
	 */
	approve: protectedProcedure
		.input(
			z.object({
				userCode: z.string().min(1),
				action: z.enum(["approve", "deny"]).default("approve"),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const userId = ctx.session.user.id;

			if (input.action === "deny") {
				await deviceRepo.deny({ userCode: input.userCode });
				return { ok: true };
			}

			await deviceRepo.approve({ userCode: input.userCode, userId });
			return { ok: true };
		}),
});
