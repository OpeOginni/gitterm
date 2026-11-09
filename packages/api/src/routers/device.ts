import z from "zod";
import { TRPCError } from "@trpc/server";
import { sessionProcedure, router } from "../index";
import { DeviceCodeRepository } from "@gitterm/redis";

const deviceRepo = new DeviceCodeRepository();

export const deviceRouter = router({
  /**
   * Approve or deny a device code authorization request
   *
   * This is used by the web UI when a user wants to approve/deny
   * a CLI device that's trying to authenticate via the device code flow.
   *
   * Session-only on purpose: approving a device code mints a new API token,
   * so an existing API token must never be able to approve one (that would
   * let a leaked token renew itself indefinitely).
   */
  approve: sessionProcedure
    .input(
      z.object({
        userCode: z.string().min(1),
        action: z.enum(["approve", "deny"]).default("approve"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userCode = input.userCode.trim().toUpperCase();
      const done =
        input.action === "deny"
          ? await deviceRepo.deny({ userCode })
          : await deviceRepo.approve({ userCode, userId: ctx.session.user.id });

      if (!done) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That code is wrong or has expired. Check your terminal for the current code.",
        });
      }
      return { ok: true };
    }),
});
