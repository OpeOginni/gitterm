import { db, eq } from "@gitpad/db";
import { workspace } from "@gitpad/db/schema/workspace";
import { auth } from "@gitpad/auth";
import "dotenv/config";
import * as http from "http";
import { WebSocket, WebSocketServer } from "ws";
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

// Create HTTP server
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
    if (req.url === "/token" || req.url.startsWith("/token?")) {
      console.log(`Token request: ${req.url}`);
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

    // Create proxy server for HTTP requests
    const proxy = httpProxy.createProxyServer({
      target: ws.backendUrl,
      changeOrigin: true,
      secure: false,
      xfwd: true,
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

// Create WebSocket server for handling upgrades
const wss = new WebSocketServer({ 
  noServer: true,
  perMessageDeflate: {
    zlibDeflateOptions: {
      // See zlib defaults.
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    // Other options settable:
    clientNoContextTakeover: true, // Defaults to negotiated value.
    serverNoContextTakeover: true, // Defaults to negotiated value.
    serverMaxWindowBits: 1024, // Defaults to negotiated value.
    // Below options specified as default values.
    concurrencyLimit: 10, // Limits zlib concurrency for perf.
    threshold: 1024 // Size (in bytes) below which messages
    // should not be compressed if context takeover is disabled.
  },
  // Explicitly handle and accept the 'tty' protocol
  handleProtocols: (protocols) => {
    if (protocols.has("tty")) {
      return "tty";
    }
    return false;
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

    const userId = await validateSession(req.headers);
    if (!userId) {
      socket.destroy();
      return;
    }

    const [ws] = await db
      .select()
      .from(workspace)
      .where(eq(workspace.subdomain, subdomain))
      .limit(1);

    if (!ws || ws.userId !== userId || !ws.backendUrl) {
      socket.destroy();
      return;
    }

    console.log(`[${ws.id}] Upgrading client connection...`);

    // Handle the upgrade using ws library
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      console.log(`[${ws.id}] Client connected, connecting to backend: ${ws.backendUrl}`);
      
      const backendUrl = new URL(ws.backendUrl!);
      const targetOrigin = backendUrl.origin;
      
      // Determine protocol (ws or wss) based on backend URL
      const protocol = backendUrl.protocol === "https:" ? "wss:" : "ws:";
      const targetWsUrl = `${protocol}//${backendUrl.host}${req.url}`;

      // Connect to backend WebSocket
      const backendWs = new WebSocket(targetWsUrl, ["tty"], {
        headers: {
          "X-Forwarded-For": req.socket.remoteAddress,
          "X-Forwarded-Proto": "https",
          "X-Forwarded-Host": host,
          "Origin": targetOrigin, // Rewrite Origin
          "Cookie": req.headers.cookie, // Forward cookies if needed
        },
        rejectUnauthorized: false // Allow self-signed if needed
      });

      // Forward messages from client to backend
      clientWs.on("message", (data) => {
        // console.log(`[${ws.id}] Client -> Backend: ${data.toString().length} bytes`);
        if (backendWs.readyState === WebSocket.OPEN) {
          backendWs.send(data);
        }
      });

      // Forward messages from backend to client
      backendWs.on("message", (data) => {
        // console.log(`[${ws.id}] Backend -> Client: ${data.toString().length} bytes`);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      });

      // Handle errors and closure
      const closeBoth = () => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        if (backendWs.readyState === WebSocket.OPEN) backendWs.close();
      };

      clientWs.on("close", () => {
        console.log(`[${ws.id}] Client closed connection`);
        closeBoth();
      });

      backendWs.on("close", () => {
        console.log(`[${ws.id}] Backend closed connection`);
        closeBoth();
      });

      clientWs.on("error", (e) => {
        console.error(`[${ws.id}] Client WS error:`, e.message);
        closeBoth();
      });

      backendWs.on("error", (e) => {
        console.error(`[${ws.id}] Backend WS error:`, e.message);
        closeBoth();
      });

      backendWs.on("open", () => {
         console.log(`[${ws.id}] Backend connection established!`);
      });
    });
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
