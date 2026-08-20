import { accountProcedure, publicProcedure, router } from "../index";

export const agentRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),

  me: accountProcedure("identity:read").query(({ ctx }) => ({
    userId: ctx.session.user.id,
    email: ctx.session.user.email,
    name: ctx.session.user.name,
    plan: ctx.session.user.plan,
    authMethod: ctx.authMethod,
  })),
});
