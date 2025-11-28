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

  console.log("SUBDOMAIN", subdomain);
  console.log("HEADERS", c.req.raw.headers);
  // Validate session
  const userId = await validateSession(c.req.raw.headers);

  console.log("VERFIED SESSION", userId);
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
  // Convert http to https for internal railway connections
  c.set("backendUrl", ws.backendUrl);
  c.set("workspaceId", ws.id);
  c.set("subdomain", subdomain);
  c.set("userId", userId);

  await next();
});

// Main handler: proxy all requests to backend
app.all("*", async (c: Context) => {
  const backendUrl = c.get("backendUrl") as string;
  const workspaceId = c.get("workspaceId") as string;
  const subdomain = c.get("subdomain") as string;
  const userId = c.get("userId") as string;
  const path = c.req.path;
  const query = c.req.url.split("?")[1] ?? "";

  try {
    // Test different URL combinations
    const urlVariations = [
      {
        name: "original",
        url: `${backendUrl}${path}${query ? "?" + query : ""}`,
      },
      {
        name: "https-converted",
        url: `${backendUrl.replace(/^http:\/\//, "https://")}${path}${query ? "?" + query : ""}`,
      },
      {
        name: "http-forced",
        url: `${backendUrl.replace(/^https:\/\//, "http://")}${path}${query ? "?" + query : ""}`,
      },
      {
        name: "root-path",
        url: `${backendUrl}/`,
      },
      {
        name: "root-https",
        url: `${backendUrl.replace(/^http:\/\//, "https://")}/`,
      },
      {
        name: "root-with-port",
        url: `${backendUrl.replace(/:\d+$/, "")}:7681/`,
      },
      {
        name: "root-https-with-port",
        url: `${backendUrl.replace(/^http:\/\//, "https://").replace(/:\d+$/, "")}:7681/`,
      },
      {
        name: "ipv6-localhost",
        url: `http://[::1]:7681/`,
      },
      {
        name: "ipv6-https-localhost",
        url: `https://[::1]:7681/`,
      },
      {
        name: "ipv6-internal",
        url: `http://[${subdomain}.railway.internal]:7681/`,
      },
      {
        name: "ipv6-https-internal",
        url: `https://[${subdomain}.railway.internal]:7681/`,
      },
      {
        name: "ipv6-service-id",
        url: `http://[${workspaceId}.railway.internal]:7681/`,
      },
      {
        name: "ipv6-https-service-id",
        url: `https://[${workspaceId}.railway.internal]:7681/`,
      },
    ];

    let lastError: any = null;

    console.log(`[${workspaceId}] Testing URL variations for: ${c.req.method} ${path}`);
    console.log(`[${workspaceId}] Backend URL: ${backendUrl}`);
    console.log(`[${workspaceId}] Available variations:`, urlVariations.map(v => v.name).join(", "));

    // Try each URL variation
    for (const variation of urlVariations) {
      try {
        console.log(`[${workspaceId}] [ATTEMPT] ${variation.name}: ${variation.url}`);
        
        let body: any;
        if (c.req.method !== "GET" && c.req.method !== "HEAD") {
          body = c.req.raw.body;
        }

        // Prepare headers for ttyd - pass user ID via auth header
        const proxyHeaders = new Headers(c.req.raw.headers as any);
        // Remove hop-by-hop headers that shouldn't be forwarded
        proxyHeaders.delete("host");
        proxyHeaders.delete("connection");
        // Add auth header for ttyd's --auth-header option
        proxyHeaders.set("X-Auth-User", userId);

        const response = await fetch(variation.url, {
          method: c.req.method,
          headers: proxyHeaders,
          body,
          signal: AbortSignal.timeout(5000),
        });

        console.log(`[${workspaceId}] [SUCCESS] ${variation.name}: ${response.status}`);

        // Add response header to identify proxied request
        const headers = new Headers(response.headers);
        headers.set("X-Proxied-For", workspaceId);
        headers.set("X-Proxy-Variation", variation.name);

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error: any) {
        console.log(`[${workspaceId}] [FAILED] ${variation.name}: ${error.message}`);
        lastError = error;
        continue;
      }
    }

    // If all variations failed, log and return error
    console.error(`[${workspaceId}] All URL variations failed`);
    console.error(`[${workspaceId}] Final error:`, {
      message: lastError?.message,
      code: lastError?.code,
      errno: lastError?.errno,
    });
    console.error(`[${workspaceId}] Tested variations:`);
    urlVariations.forEach(v => {
      console.error(`  - ${v.name}: ${v.url}`);
    });
    
    return c.text(`Bad Gateway - All connection attempts failed. Last error: ${lastError?.message || "Unknown"}`, 502);
  } catch (error) {
    console.error(`[${workspaceId}] Proxy handler error:`, error);
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
