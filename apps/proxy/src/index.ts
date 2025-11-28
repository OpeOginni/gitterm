import { Hono } from "hono";
import type { Context } from "hono";
import { logger } from "hono/logger";
import { db, eq } from "@gitpad/db";
import { workspace } from "@gitpad/db/schema/workspace";
import { auth } from "@gitpad/auth";
import "dotenv/config";

const PORT = parseInt(process.env.PORT || "3000");
const app = new Hono();

// Middleware: logger
app.use(logger());

// CORS middleware for subdomain support
app.use("*", async (c: Context, next: any) => {
  const origin = c.req.header("origin") || "";
  const BASE_DOMAIN = process.env.BASE_DOMAIN || "gitterm.dev";
  
  // Allow subdomains of gitterm.dev
  if (origin.endsWith(`.${BASE_DOMAIN}`) || origin.includes(BASE_DOMAIN)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    c.header("Access-Control-Allow-Headers", "Authorization,Content-Type,Cookie");
    c.header("Access-Control-Allow-Credentials", "true");
  }
  
  // Handle preflight requests
  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  
  await next();
});

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "proxy"
  });
});

// Helper to validate session from request headers
async function validateSession(headers: any): Promise<string | null> {
  try {
    const session = await auth.api.getSession({
      headers,
    });
    return session?.user?.id ?? null;
  } catch (error) {
    console.error("Session validation error:", error);
    return null;
  }
}

// Helper to extract subdomain from host
function extractSubdomain(host: string): string {
  const parts = host.split(".");

  // Production: ws-123.gitterm.dev -> ws-123
  if (parts.length >= 3) {
    return parts[0] ?? "";
  }

  // Local testing: ws-123.localhost:port -> ws-123
  if (host.includes("localhost") && parts.length >= 2) {
    return parts[0] ?? "";
  }

  return "";
}

// Middleware: Auth and workspace resolution
app.use("*", async (c: Context, next: any) => {
  const host = c.req.header("host");

  if (!host) {
    return c.text("Missing Host header", 400);
  }

  const subdomain = extractSubdomain(host);

  if (!subdomain) {
    return c.text("Invalid subdomain", 400);
  }

  // Validate session
  const userId = await validateSession(c.req.raw.headers);

  if (!userId) {
    return c.text("Unauthorized", 401);
  }

  console.log("VERFIED SESSION", userId);

  // Lookup workspace
  const [ws] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.subdomain, subdomain))
    .limit(1);

  if (!ws) {
    return c.text("Workspace not found", 404);
  }

  // Check ownership
  if (ws.userId !== userId) {
    return c.text("Forbidden", 403);
  }

  // Check backend URL is ready
  if (!ws.backendUrl) {
    return c.text("Workspace backend not ready", 503);
  }

  // Store in context for use in handlers
  c.set("backendUrl", ws.backendUrl);
  c.set("workspaceId", ws.id);
  c.set("subdomain", subdomain);

  await next();
});

// Main handler: proxy all requests to backend
app.all("*", async (c: Context) => {
  const backendUrl = c.get("backendUrl") as string;
  const workspaceId = c.get("workspaceId") as string;
  const path = c.req.path;
  const query = c.req.url.split("?")[1] ?? "";

  try {
    const targetUrl = `${backendUrl}${path}${query ? "?" + query : ""}`;
    console.log(`[${workspaceId}] ${c.req.method} ${targetUrl}`);

    // Get request body if applicable
    let body: any;
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      body = c.req.raw.body;
    }

    // Forward request
    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers: c.req.raw.headers as any,
      body,
    });

    // Add response header to identify proxied request
    const headers = new Headers(response.headers);
    headers.set("X-Proxied-For", workspaceId);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error(`[${workspaceId}] Proxy error:`, error);
    return c.text("Bad Gateway", 502);
  }
});

// Start server using Bun/Node's built-in fetch server
const server = Bun?.serve ? 
  Bun.serve({ 
    port: PORT, 
    fetch: app.fetch,
    hostname: "0.0.0.0"
  }) :
  undefined;

if (server) {
  console.log(`🔄 Proxy server listening on http://0.0.0.0:${PORT}`);
} else {
  // Fallback for Node.js using http.createServer
  import("http").then((http) => {
    const srv = http.createServer(app.fetch as any);
    srv.listen(PORT, "0.0.0.0", () => {
      console.log(`🔄 Proxy server listening on http://0.0.0.0:${PORT}`);
      console.log("Wildcard subdomains routed via Cloudflare DNS");
    });

    process.on("SIGTERM", () => {
      console.log("SIGTERM received, shutting down gracefully");
      srv.close(() => {
        process.exit(0);
      });
    });
  });
}
