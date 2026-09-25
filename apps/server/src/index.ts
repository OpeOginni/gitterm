import "dotenv/config";
import env from "@gitterm/env/server";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@gitterm/api/context";
import { appRouter, proxyResolverRouter } from "@gitterm/api/routers/index";
import { auth } from "@gitterm/auth";
import { DeviceCodeService } from "@gitterm/api/service/auth/cli/device-code";
import { getGitHubAppService } from "@gitterm/api/service/github";
import { workspaceJWT } from "@gitterm/api/service/auth/workspace-jwt";
import { startRunWatcherSweep } from "@gitterm/api/service/agent-run";
import { and, db, eq } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import { googleCloudIntegration, googleIssuerConfig } from "@gitterm/db/schema/integrations";
import {
  issueGoogleSubjectToken,
  workloadIdentityDiscovery,
  workloadIdentityJwks,
  workloadIdentitySignerConfig,
} from "@gitterm/api/service/workload-identity/google";
import { integrationPolicy } from "@gitterm/api/service/integrations/catalog";
import { recordCredentialAudit } from "@gitterm/api/service/credential-audit";

import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();
const deviceCodeService = new DeviceCodeService();

// app.use(logger());
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
    if (!(await integrationPolicy("github")).enabled) {
      return c.redirect(`${webUrl}/dashboard/integrations?error=github_disabled`);
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
      const githubAppService = await getGitHubAppService();

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

  const result = await deviceCodeService.exchangeDeviceCode(body.deviceCode);
  if (!result) return c.json({ error: "authorization_pending" }, 428);

  return c.json({
    accessToken: result.token,
    tokenType: "Bearer",
    expiresInSeconds: result.expiresInSeconds,
  });
});

app.get("/api/workload-identity/.well-known/openid-configuration", async (c) => {
  try {
    return c.json(workloadIdentityDiscovery(await workloadIdentitySignerConfig()), 200, {
      "Cache-Control": "public, max-age=300",
    });
  } catch {
    return c.json({ error: "workload_identity_unavailable" }, 503);
  }
});

app.get("/api/workload-identity/jwks", async (c) => {
  try {
    const signer = await workloadIdentitySignerConfig();
    const jwks = workloadIdentityJwks(signer);
    const [stored] = await db
      .select()
      .from(googleIssuerConfig)
      .where(eq(googleIssuerConfig.id, "google"));
    if (
      stored?.previousPublicKey &&
      stored.previousKeyExpiresAt &&
      stored.previousKeyExpiresAt > new Date()
    ) {
      jwks.keys.push(stored.previousPublicKey);
    }
    return c.json(jwks, 200, { "Cache-Control": "public, max-age=300" });
  } catch {
    return c.json({ error: "workload_identity_unavailable" }, 503);
  }
});

app.get("/api/workload-identity/google/subject-token", async (c) => {
  if (!(await integrationPolicy("google")).enabled)
    return c.json({ error: "google_integration_disabled" }, 403);
  const authHeader = c.req.header("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let payload;
  try {
    payload = workspaceJWT.verifyToken(token, "agent");
  } catch {
    return c.json({ error: "invalid_workspace_identity" }, 401);
  }
  if (!workspaceJWT.hasScope(payload, "agent:credential")) {
    return c.json({ error: "insufficient_scope" }, 403);
  }

  const [record] = await db
    .select({
      workspaceId: workspace.id,
      userId: workspace.userId,
      status: workspace.status,
      authVersion: workspace.authVersion,
      integrationId: googleCloudIntegration.id,
      projectId: googleCloudIntegration.projectId,
      workloadIdentityProvider: googleCloudIntegration.workloadIdentityProvider,
      serviceAccountEmail: googleCloudIntegration.serviceAccountEmail,
    })
    .from(workspace)
    .innerJoin(
      googleCloudIntegration,
      eq(workspace.googleCloudIntegrationId, googleCloudIntegration.id),
    )
    .where(
      and(
        eq(workspace.id, payload.workspaceId),
        eq(workspace.userId, payload.userId),
        eq(googleCloudIntegration.active, true),
      ),
    );
  if (!record || record.status !== "running" || record.authVersion !== payload.authVersion) {
    return c.json({ error: "workspace_identity_unavailable" }, 403);
  }

  const subjectToken = issueGoogleSubjectToken(
    {
      workspaceId: record.workspaceId,
      userId: record.userId,
      integrationId: record.integrationId,
    },
    { ...record, id: record.integrationId },
    await workloadIdentitySignerConfig(),
  );
  await recordCredentialAudit({
    workspaceId: record.workspaceId,
    userId: record.userId,
    credentialKind: "google",
    integrationId: record.integrationId,
    action: "issued",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    metadata: { projectId: record.projectId },
  });
  return c.json({ subject_token: subjectToken, expires_in: 300 }, 200, {
    "Cache-Control": "no-store",
  });
});

const trpcHandler = trpcServer({
  router: appRouter,
  createContext: (_opts, context) => {
    return createContext({ context });
  },
  onError: ({ path, type, error, req }) => {
    const cause = error.cause ?? error;
    console.error(
      `[tRPC] ${type} "${path ?? "<unknown>"}" → ${error.code}: ${error.message}`,
      "\n  cause:",
      cause instanceof Error ? `${cause.name}: ${cause.message}\n${cause.stack}` : cause,
      "\n  url:",
      req.url,
    );
  },
});

// /api/trpc lets an API base ending in /api (https://api.example.com/api) reach
// tRPC when the host points straight at this server instead of the proxy.
app.use("/trpc/*", trpcHandler);
app.use("/api/trpc/*", trpcHandler);

app.get("/api/internal/proxy-resolve", async (c) => await proxyResolverRouter(c));

app.get("/", (c) => {
  return c.text("OK");
});

app.get("/api/health", (c) => {
  return c.json({ status: "healthy" });
});

// Active runs are advanced only by a watcher; this re-attaches after a restart
// and keeps ownership balanced across replicas.
startRunWatcherSweep();

export default {
  fetch: app.fetch,
  hostname: "::",
  port: env.PORT,
  // Keep long runtime startup checks alive while remote providers boot.
  idleTimeout: 255,
};
