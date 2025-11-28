import { db, eq } from "@gitpad/db";
import { workspace } from "@gitpad/db/schema/workspace";
import { auth } from "@gitpad/auth";
import "dotenv/config";
import * as http from "http";
import httpProxy from "http-proxy";

const PORT = parseInt(process.env.PORT || "3000");

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

// Create HTTP server with proper WebSocket support
const server = http.createServer(async (req: any, res: any) => {
  try {
    // Health check endpoint
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "healthy",
        timestamp: new Date().toISOString(),
        service: "proxy"
      }));
      return;
    }

    // Parse request
    const host = req.headers.host;
    if (!host) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing Host header");
      return;
    }

    const subdomain = extractSubdomain(host);
    if (!subdomain) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid subdomain");
      return;
    }

    console.log("SUBDOMAIN", subdomain);
    console.log("HEADERS", req.headers);

    // Validate session
    const userId = await validateSession(req.headers);
    console.log("VERIFIED SESSION", userId);

    if (!userId) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized");
      return;
    }

    // Lookup workspace
    const [ws] = await db
      .select()
      .from(workspace)
      .where(eq(workspace.subdomain, subdomain))
      .limit(1);

    if (!ws) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Workspace not found");
      return;
    }

    if (ws.userId !== userId) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    if (!ws.backendUrl) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Workspace backend not ready");
      return;
    }

    console.log(`[${ws.id}] ${req.method} ${req.url}`);

    // Create proxy server with WebSocket support
    const proxy = httpProxy.createProxyServer({
      target: ws.backendUrl,
      ws: true,
      changeOrigin: true,
      secure: false, // Allow self-signed certificates
    });

    // Add auth header to proxied requests
    proxy.on("proxyReq", (proxyReq: any) => {
      proxyReq.setHeader("X-Auth-User", userId);
    });

    // Handle proxy errors
    proxy.on("error", (error: any) => {
      console.error(`[${ws.id}] Proxy error:`, error);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Bad Gateway");
      }
    });

    // Forward HTTP request
    proxy.web(req, res);
  } catch (error) {
    console.error("Request handler error:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  }
});

// Handle WebSocket upgrades
server.on("upgrade", async (req: any, socket: any, head: any) => {
  try {
    const host = req.headers.host;
    if (!host) {
      socket.destroy();
      return;
    }

    const subdomain = extractSubdomain(host);
    if (!subdomain) {
      socket.destroy();
      return;
    }

    console.log(`[${subdomain}] WebSocket upgrade requested`);

    // Validate session
    const userId = await validateSession(req.headers);
    if (!userId) {
      socket.destroy();
      return;
    }

    // Lookup workspace
    const [ws] = await db
      .select()
      .from(workspace)
      .where(eq(workspace.subdomain, subdomain))
      .limit(1);

    if (!ws) {
      socket.destroy();
      return;
    }

    if (ws.userId !== userId) {
      socket.destroy();
      return;
    }

    if (!ws.backendUrl) {
      socket.destroy();
      return;
    }

    console.log(`[${ws.id}] WebSocket upgrade: ${req.url}`);

    // Create proxy for WebSocket
    const proxy = httpProxy.createProxyServer({
      target: ws.backendUrl,
      ws: true,
      changeOrigin: true,
      secure: false,
    });

    // Add auth header
    proxy.on("proxyReq", (proxyReq: any) => {
      proxyReq.setHeader("X-Auth-User", userId);
    });

    // Handle errors
    proxy.on("error", (error: any) => {
      console.error(`[${ws.id}] WebSocket proxy error:`, error);
      socket.destroy();
    });

    // Forward WebSocket upgrade
    proxy.ws(req, socket, head);
  } catch (error) {
    console.error("WebSocket upgrade error:", error);
    socket.destroy();
  }
});

// Start server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🔄 Proxy server listening on http://0.0.0.0:${PORT}`);
  console.log("Wildcard subdomains routed via Cloudflare DNS");
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    process.exit(0);
  });
});
