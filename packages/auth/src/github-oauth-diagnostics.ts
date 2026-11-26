import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

export const githubOAuthDiagnostics = {
  id: "github-oauth-diagnostics",
  hooks: {
    after: [
      {
        matcher: (ctx) =>
          (ctx.path === "/sign-in/social" && ctx.body?.provider === "github") ||
          (ctx.path === "/callback/:id" && ctx.params?.id === "github"),
        handler: createAuthMiddleware(async (ctx) => {
          const name = ctx.context.createAuthCookie("state").name;
          const headers = ctx.context.responseHeaders;
          if (ctx.path === "/sign-in/social") {
            const stateCookieSet = headers
              ?.getSetCookie()
              .some((cookie) => cookie.startsWith(`${name}=`));
            console.info("[github-oauth-diagnostics] sign-in", {
              stateCookieSet: stateCookieSet ?? false,
            });
            return;
          }

          const location = headers?.get("location");
          if (
            !location ||
            new URL(location, ctx.context.baseURL).searchParams.get("error") !== "state_mismatch"
          ) {
            return;
          }

          const stateCookieReceived = Boolean(ctx.getCookie(name));
          const signatureVerified =
            stateCookieReceived && Boolean(await ctx.getSignedCookie(name, ctx.context.secret));
          console.info("[github-oauth-diagnostics] callback state mismatch", {
            stateCookieReceived,
            signatureVerified,
          });
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin;
