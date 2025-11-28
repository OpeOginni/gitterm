import { db, eq } from "@gitpad/db";
import { workspace } from "@gitpad/db/schema/workspace";
import { auth } from "@gitpad/auth";
import "dotenv/config";
import * as http from "http";
import { WebSocket, WebSocketServer } from "ws";
import httpProxy from "http-proxy";
import * as dns from "dns";

// Force IPv6 resolution for Railway internal network
dns.setDefaultResultOrder('ipv6first');

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

// Create HTTP server with IPv6 support
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

    console.log(`[${ws.id}] ${req.method} ${req.url} -> ${ws.backendUrl}`);

    // Create proxy server with IPv6 support
    const proxy = httpProxy.createProxyServer({
      target: ws.backendUrl,
      changeOrigin: true,
      secure: false,
      xfwd: true,
      ws: false,
      // Enable IPv6
      agent: new http.Agent({
        family: 6, // Force IPv6
        keepAlive: true,
        keepAliveMsecs: 1000,
      }),
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
      console.error(`[${ws.id}] Proxy error:`, error.message, error.code);
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
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
    threshold: 1024
  },
  // Handle the 'tty' protocol that ttyd uses
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
      console.error("No host header in upgrade request");
      socket.destroy();
      return;
    }

    const subdomain = extractSubdomain(host);
    if (!subdomain) {
      console.error("Invalid subdomain in upgrade request");
      socket.destroy();
      return;
    }

    console.log(`[${subdomain}] WebSocket upgrade requested for ${req.url}`);

    const userId = await validateSession(req.headers);
    if (!userId) {
      console.error(`[${subdomain}] Unauthorized upgrade attempt`);
      socket.destroy();
      return;
    }

    const [ws] = await db
      .select()
      .from(workspace)
      .where(eq(workspace.subdomain, subdomain))
      .limit(1);

    if (!ws || ws.userId !== userId || !ws.backendUrl) {
      console.error(`[${subdomain}] Invalid workspace or no backend URL`);
      socket.destroy();
      return;
    }

    console.log(`[${ws.id}] Upgrading client connection...`);

    // Handle the upgrade using ws library
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      console.log(`[${ws.id}] Client connected, connecting to backend: ${ws.backendUrl}`);
      
      const backendUrl = new URL(ws.backendUrl!);
      
      // Determine protocol (ws or wss) based on backend URL
      const protocol = backendUrl.protocol === "https:" ? "wss:" : "ws:";
      const targetWsUrl = `${protocol}//${backendUrl.host}${req.url}`;
      
      console.log(`[${ws.id}] Connecting to: ${targetWsUrl}`);

      // Buffer for messages received before backend connects
      const messageBuffer: Array<{ data: any; isBinary: boolean }> = [];
      let backendConnected = false;

      // Connect to backend WebSocket with IPv6 support
      const backendWs = new WebSocket(targetWsUrl, ["tty"], {
        headers: {
          "Host": backendUrl.host,
          "X-Forwarded-For": req.socket.remoteAddress,
          "X-Forwarded-Proto": "https",
          "X-Forwarded-Host": host,
          "User-Agent": req.headers["user-agent"] || "GitPad-Proxy/1.0",
          ...(req.headers.cookie ? { "Cookie": req.headers.cookie } : {}),
        },
        // IPv6 support for Railway internal network
        family: 6, // Force IPv6
        rejectUnauthorized: false,
        perMessageDeflate: true,
        handshakeTimeout: 10000, // 10 second timeout
      });

      // Set up ping/pong for keepalive
      let pingInterval: NodeJS.Timeout;
      
      backendWs.on("open", () => {
        console.log(`[${ws.id}] Backend connection established!`);
        backendConnected = true;
        
        // Send any buffered messages
        if (messageBuffer.length > 0) {
          console.log(`[${ws.id}] Sending ${messageBuffer.length} buffered messages`);
          messageBuffer.forEach(({ data, isBinary }) => {
            backendWs.send(data, { binary: isBinary });
          });
          messageBuffer.length = 0;
        }

        // Start keepalive ping
        pingInterval = setInterval(() => {
          if (backendWs.readyState === WebSocket.OPEN) {
            backendWs.ping();
          }
        }, 30000); // Ping every 30 seconds
      });

      // Forward messages from client to backend
      clientWs.on("message", (data, isBinary) => {
        if (backendConnected && backendWs.readyState === WebSocket.OPEN) {
          backendWs.send(data, { binary: isBinary });
        } else if (!backendConnected) {
          // Buffer messages until backend connects
          messageBuffer.push({ data, isBinary });
          if (messageBuffer.length <= 5) {
            console.log(`[${ws.id}] Buffered message (${messageBuffer.length} total)`);
          }
        }
      });

      // Forward messages from backend to client
      backendWs.on("message", (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      });

      // Handle pong responses
      backendWs.on("pong", () => {
        // Backend is alive
      });

      // Handle errors and closure
      const closeBoth = () => {
        if (pingInterval) {
          clearInterval(pingInterval);
        }
        
        if (clientWs.readyState === WebSocket.OPEN || 
            clientWs.readyState === WebSocket.CONNECTING) {
          clientWs.close();
        }
        
        if (backendWs.readyState === WebSocket.OPEN || 
            backendWs.readyState === WebSocket.CONNECTING) {
          backendWs.close();
        }
      };

      clientWs.on("close", (code, reason) => {
        console.log(`[${ws.id}] Client closed connection: ${code} ${reason}`);
        closeBoth();
      });

      backendWs.on("close", (code, reason) => {
        console.log(`[${ws.id}] Backend closed connection: ${code} ${reason}`);
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

      // Handle client ping (respond with pong)
      clientWs.on("ping", () => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.pong();
        }
      });
    });
  } catch (error) {
    console.error("WebSocket upgrade error:", error);
    socket.destroy();
  }
});

// Start server - Listen on all interfaces (both IPv4 and IPv6)
server.listen(PORT, "::", () => {
  console.log(`🔄 Proxy server listening on [::]:${PORT} (IPv4 + IPv6)`);
  console.log("Wildcard subdomains routed via Cloudflare DNS");
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    process.exit(0);
  });
});