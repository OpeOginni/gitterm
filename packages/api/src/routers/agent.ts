import { accountProcedure, router } from "../index";
import { getBilling } from "../billing";

export const agentRouter = router({
  me: accountProcedure("identity:read").query(async ({ ctx }) => ({
    userId: ctx.session.user.id,
    email: ctx.session.user.email,
    name: ctx.session.user.name,
    plan: (await (await getBilling()).getEntitlements(ctx.session.user.id)).plan,
    authMethod: ctx.authMethod,
  })),
});
