import "dotenv/config";
import env from "@gitterm/env/server";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@gitterm/api/context";
import { appRouter, proxyResolverRouter } from "@gitterm/api/routers/index";
import { auth } from "@gitterm/auth";
import { DeviceCodeService } from "@gitterm/api/service/cli/device-code";
import { CLIAutheService } from "@gitterm/api/service/cli/cli-auth";
import { getGitHubAppService } from "@gitterm/api/service/github";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();
const deviceCodeService = new DeviceCodeService();
const agentAuthService = new CLIAutheService();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: (origin) => {
      if (!origin) return null;

      // Allow main web app domain (app.gitterm.dev or gitterm.dev)
      // But NOT workspace subdomains (123.gitterm.dev) - those go through proxy
      const allowedOrigins = [`https://${env.BASE_DOMAIN}`, `http://${env.BASE_DOMAIN}`];

      if (origin.includes("localhost")) return origin;

      return allowedOrigins.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Cookie"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// GitHub App Installation callback
// Called after user installs/updates the GitHub App
app.get("/api/github/callback", async (c) => {
  const webUrl = env.BASE_URL || `http://${env.BASE_DOMAIN}`;

  try {
    // Get session from auth
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.redirect(`${webUrl}/login?returnTo=/dashboard/integrations`);
    }

    const installationId = c.req.query("installation_id");
    const setupAction = c.req.query("setup_action") || "install";

    if (!installationId) {
      console.error("[GitHub Setup] Missing installation_id parameter");
      return c.redirect(`${webUrl}/dashboard/integrations?error=missing_installation_id`);
    }

    console.log("[GitHub Setup] Received callback:", {
      userId: session.user.id,
      installationId,
      setupAction,
    });

    try {
      const githubAppService = getGitHubAppService();

      // Get installation details from GitHub
      const installationData = await githubAppService.getInstallationDetails(installationId);

      // Store installation in database
      await githubAppService.storeInstallation({
        userId: session.user.id,
        installationId,
        accountId: installationData.account.id.toString(),
        accountLogin: installationData.account.login,
        accountType: installationData.account.type,
        repositorySelection: installationData.repositorySelection,
      });

      console.log("[GitHub Setup] Installation saved successfully:", {
        userId: session.user.id,
        installationId,
        accountLogin: installationData.account.login,
      });

      return c.redirect(`${webUrl}/dashboard/integrations?success=github_connected`);
    } catch (error) {
      console.error("[GitHub Setup] Failed to handle installation:", error);
      return c.redirect(`${webUrl}/dashboard/integrations?error=installation_failed`);
    }
  } catch (error) {
    console.error("[GitHub Setup] Callback error:", error);
    return c.redirect(`${webUrl}/dashboard/integrations?error=callback_failed`);
  }
});

// Device code flow for CLI/agent login.
app.post("/api/device/code", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { clientName?: string };
  return c.json(await deviceCodeService.startDeviceLogin({ clientName: body.clientName }));
});

app.post("/api/device/token", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { deviceCode?: string };
  if (!body.deviceCode) return c.json({ error: "invalid_request" }, 400);

  const result = await agentAuthService.exchangeDeviceCode(body.deviceCode);
  if (!result) return c.json({ error: "authorization_pending" }, 428);

  return c.json({
    accessToken: result.cliToken,
    tokenType: "Bearer",
    expiresInSeconds: 30 * 24 * 60 * 60,
  });
});

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  }),
);

app.get("/api/internal/proxy-resolve", async (c) => await proxyResolverRouter(c));

app.get("/", (c) => {
  return c.text("OK");
});

app.get("/api/health", (c) => {
  return c.json({ status: "healthy" });
});

export default {
  fetch: app.fetch,
  hostname: "::",
  port: env.PORT,
};
