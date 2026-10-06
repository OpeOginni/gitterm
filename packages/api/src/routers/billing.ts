import { protectedProcedure, router } from "../index";
import { getBilling } from "../billing";

export const billingRouter = router({
  /** The viewer's plan (null when billing is off) and what they may use. */
  account: protectedProcedure.query(async ({ ctx }) => {
    const billing = await getBilling();
    const [account, entitlements] = await Promise.all([
      billing.getAccount(ctx.session.user.id),
      billing.getEntitlements(ctx.session.user.id),
    ]);
    return { account, entitlements };
  }),
});
