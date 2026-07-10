import z from "zod";
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
      const userId = ctx.session.user.id;

      if (input.action === "deny") {
        await deviceRepo.deny({ userCode: input.userCode });
        return { ok: true };
      }

      await deviceRepo.approve({ userCode: input.userCode, userId });
      return { ok: true };
    }),
});
