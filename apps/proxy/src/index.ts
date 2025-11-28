import { db, eq } from "@gitpad/db";
import { workspace } from "@gitpad/db/schema/workspace";
import { auth } from "@gitpad/auth";
import "dotenv/config";
import * as http from "http";
import * as https from "https";
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

    // For ttyd's token endpoint, we just need to pass through
    // ttyd uses /token to initiate WebSocket negotiation
    if (req.url === "/token" || req.url.startsWith("/token?")) {
      console.log(`Token request: ${req.url}`);
      // Continue to proxy this below
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

    // Add auth and forwarding headers to proxied requests
    proxy.on("proxyReq", (proxyReq: any) => {
      proxyReq.setHeader("X-Auth-User", userId);
      proxyReq.setHeader("X-Forwarded-For", req.socket.remoteAddress);
      proxyReq.setHeader("X-Forwarded-Proto", "https");
      proxyReq.setHeader("X-Forwarded-Host", host);
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
    console.log(`[${ws.id}] Request headers:`, {
      connection: req.headers.connection,
      upgrade: req.headers.upgrade,
      "sec-websocket-key": req.headers["sec-websocket-key"],
      "sec-websocket-protocol": req.headers["sec-websocket-protocol"],
      "sec-websocket-version": req.headers["sec-websocket-version"],
    });

    // Parse target URL
    const targetUrl = new URL(ws.backendUrl!);
    const isSecure = targetUrl.protocol === "https:";
    const port = parseInt(targetUrl.port) || (isSecure ? 443 : 80);
    const hostname = targetUrl.hostname;

    console.log(`[${ws.id}] Connecting to backend: ${hostname}:${port} (secure: ${isSecure})`);

    // Create backend request with upgrade headers
    const backendReq = (isSecure ? https : http).request(
      {
        hostname,
        port,
        path: req.url,
        method: "GET",
        headers: {
          "Upgrade": "websocket",
          "Connection": "Upgrade",
          "Sec-WebSocket-Key": req.headers["sec-websocket-key"],
          "Sec-WebSocket-Version": req.headers["sec-websocket-version"],
          "Sec-WebSocket-Protocol": req.headers["sec-websocket-protocol"] || "",
          "X-Forwarded-For": req.socket.remoteAddress,
          "X-Forwarded-Proto": "https",
          "X-Forwarded-Host": host,
          "Origin": targetUrl.origin, // Rewrite Origin just in case
        },
      }
    );

    const handleUpgrade = (res: any, backendSocket: any) => {
      console.log(`[${ws.id}] WebSocket upgrade successful! Protocol: ${res.headers["sec-websocket-protocol"]}`);
      
      // Send upgrade response to client
      const responseHeaders = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${res.headers["sec-websocket-accept"]}`,
        `Sec-WebSocket-Protocol: ${res.headers["sec-websocket-protocol"] || "tty"}`,
        "\r\n"
      ].join("\r\n");

      socket.write(responseHeaders);

      // Pipe data bidirectionally
      socket.pipe(backendSocket);
      backendSocket.pipe(socket);

      backendSocket.on("close", () => {
        console.log(`[${ws.id}] Backend closed`);
        socket.end();
      });

      socket.on("close", () => {
        console.log(`[${ws.id}] Client closed`);
        backendSocket.end();
      });
    };

    backendReq.on("upgrade", (res: any, backendSocket: any) => {
      handleUpgrade(res, backendSocket);
    });

    backendReq.on("response", (res: any) => {
      console.log(`[${ws.id}] Backend response status: ${res.statusCode}`);
      
      // Fallback: If we get 101 in response event instead of upgrade
      if (res.statusCode === 101) {
        console.log(`[${ws.id}] Handling 101 via response event. Headers:`, res.headers);
        handleUpgrade(res, res.socket);
        return;
      }

      // If not 101, it's likely an error
      console.log(`[${ws.id}] Backend rejected upgrade. Headers:`, res.headers);
      socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n\r\n`);
      socket.destroy();
    });

    backendReq.on("error", (error: any) => {
      console.error(`[${ws.id}] Backend error:`, error.message);
      socket.destroy();
    });

    socket.on("error", (error: any) => {
      console.error(`[${ws.id}] Socket error:`, error.message);
      backendReq.destroy();
    });

    backendReq.end(head);
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
