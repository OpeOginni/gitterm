import { internalClient } from "@gitpad/api/client/internal";
import "dotenv/config";
import * as http from "http";
import * as https from "https";
import { WebSocket, WebSocketServer } from "ws";
import httpProxy from "http-proxy";
import * as dns from "dns";

// Force IPv6 resolution for Railway internal network
dns.setDefaultResultOrder('ipv6first');

// Heartbeat tracking - debounce updates to avoid API spam
const lastHeartbeatTime = new Map<string, number>();
const HEARTBEAT_DEBOUNCE_MS = 30_000; // Only update every 30 seconds per workspace

async function updateWorkspaceHeartbeat(workspaceId: string): Promise<void> {
  const now = Date.now();
  const lastTime = lastHeartbeatTime.get(workspaceId) || 0;
  
  // Debounce: only update if 30+ seconds since last update
  if (now - lastTime < HEARTBEAT_DEBOUNCE_MS) {
    return;
  }
  
  lastHeartbeatTime.set(workspaceId, now);
  
  try {
    await internalClient.internal.updateHeartbeat.mutate({ workspaceId });
    console.log(`[${workspaceId}] Heartbeat updated via API`);
  } catch (error) {
    console.error(`[${workspaceId}] Failed to update heartbeat:`, error);
  }
}

const PORT = parseInt(process.env.PORT || "3000");

// Helper to validate session from request headers via internal API
async function validateSession(headers: any): Promise<string | null> {
  try {
    // Extract cookie header for session validation
    const cookie = headers.cookie || headers.Cookie;
    
    if (!cookie) {
      return null;
    }
    
    // Call internal API to validate session (avoids direct DB access)
    const result = await internalClient.internal.validateSession.query({ 
      cookie 
    });
    
    return result.userId;
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

// Check if request is for a static asset that doesn't need auth
function isPublicAsset(url: string): boolean {
  const publicExtensions = [
    '.js', '.css', '.map', '.ico', '.png', '.jpg', '.jpeg', 
    '.gif', '.svg', '.woff', '.woff2', '.ttf', '.eot',
    '.webmanifest', '.json'
  ];
  
  const publicPaths = [
    '/assets/',
    '/favicon',
    '/site.webmanifest',
    '/@vite/',
    '/@fs/',
    '/node_modules/'
  ];
  
  // Check if URL matches public extensions
  const hasPublicExtension = publicExtensions.some(ext => url.toLowerCase().endsWith(ext));
  
  // Check if URL starts with public paths
  const hasPublicPath = publicPaths.some(path => url.toLowerCase().startsWith(path));
  
  return hasPublicExtension || hasPublicPath;
}

// Create a reusable proxy instance per workspace to avoid creating new ones each time
const proxyCache = new Map<string, httpProxy>();

function getOrCreateProxy(workspaceId: string): httpProxy {
  if (!proxyCache.has(workspaceId)) {
    const proxy = httpProxy.createProxyServer({
      changeOrigin: true,
      secure: false,
      xfwd: true,
      ws: false,
      timeout: 60000, // 60 second timeout for large assets
      proxyTimeout: 60000,
      // Don't set agent here - we'll handle it per request
    });
    
    proxyCache.set(workspaceId, proxy);
  }
  
  return proxyCache.get(workspaceId)!;
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

    // Lookup workspace via internal API
    let ws;
    try {
      ws = await internalClient.internal.getWorkspaceBySubdomain.query({ subdomain });
    } catch (error: any) {
      if (error?.data?.code === "NOT_FOUND") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Workspace not found");
        return;
      }
      throw error;
    }

    let userId: string | null = null;
    const isPublicRequest = isPublicAsset(req.url);
    
    // Skip auth for public assets OR serverOnly workspaces
    if (!ws.serverOnly && !isPublicRequest) {
      userId = await validateSession(req.headers);
      if (!userId) {
        console.log(`[${subdomain}] Unauthorized: ${req.url}`);
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
      if (ws.userId !== userId) {
        console.log(`[${subdomain}] Forbidden: ${req.url}`);
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }
    }

    if (!ws.backendUrl) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Workspace backend not ready");
      return;
    }

    // Check if this is a streaming endpoint (SSE, webhooks, etc.)
    const isStreamingEndpoint = req.url.includes('/event') || 
                                req.url.includes('/stream') || 
                                req.headers.accept?.includes('text/event-stream');

    // Check if this is a static asset 
    const staticAssetExtensions = ['.js', '.css', '.webmanifest', '.ico', '.svg', '.woff2', '.woff', '.ttf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const isStaticAsset = staticAssetExtensions.some(ext => req.url.toLowerCase().endsWith(ext));
    
    // =========================================================================
    // FIX FOR SSE: Manual Proxy with No Timeouts & Instant Flushing
    // =========================================================================
    if (isStreamingEndpoint) {
      console.log(`[${ws.id}] Using manual SSE proxy for: ${req.url}`);
      
      // 1. CRITICAL: Disable timeouts for SSE. Connections must stay open.
      if (req.socket) {
        req.socket.setTimeout(0); 
        req.socket.setNoDelay(true); // Disable Nagle's algorithm for instant updates
        req.socket.setKeepAlive(true);
      }

      const backendUrl = new URL(ws.backendUrl);
      
      const options: http.RequestOptions = {
        hostname: backendUrl.hostname,
        port: backendUrl.port || 80,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: backendUrl.host,
          'x-forwarded-for': req.socket.remoteAddress || '',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': host,
          // Force connection keep-alive to backend
          'connection': 'keep-alive',
          'cache-control': 'no-cache' 
        },
        family: 6,
        // Ensure agent keeps socket open
        agent: new https.Agent({ 
            keepAlive: true,
            maxSockets: Infinity 
        })
      };
      
      if (!ws.serverOnly && userId) {
        (options.headers as any)['x-auth-user'] = userId;
      }
      
      const requestModule = backendUrl.protocol === 'https:' ? https : http;
      const proxyReq = requestModule.request(options, (proxyRes) => {
        console.log(`[${ws.id}] SSE response: ${proxyRes.statusCode} for ${req.url}`);
        
        // 2. Force SSE Headers on the response to the client
        const headers = {
          ...proxyRes.headers,
          'content-type': 'text/event-stream', // Force correct type
          'cache-control': 'no-cache, no-transform',
          'connection': 'keep-alive',
          'x-accel-buffering': 'no', // Tell Nginx/Cloudflare not to buffer
          'transfer-encoding': 'chunked' // Usually implied, but good to be explicit for streams
        };

        // Remove Content-Length if it exists (SSE is infinite)
        delete headers['content-length'];

        res.writeHead(proxyRes.statusCode || 200, headers);
        
        // 3. Flush headers immediately if method exists (Node 15+)
        if (res.flushHeaders) res.flushHeaders();

        // 4. Pipe with heartbeat monitoring
        proxyRes.on('data', (chunk) => {
          // Keep the workspace "active" in your DB whenever data flows
          updateWorkspaceHeartbeat(ws.id);
          res.write(chunk);
          // 5. Explicitly flush output if using compression middleware (though not present here, safety first)
          if ((res as any).flush) (res as any).flush();
        });

        proxyRes.on('end', () => {
          console.log(`[${ws.id}] SSE Stream ended by backend`);
          res.end();
        });

        proxyRes.on('error', (err) => {
          console.error(`[${ws.id}] SSE stream error:`, err.message);
          res.end();
        });
      });
      
      proxyReq.on('error', (err) => {
        console.error(`[${ws.id}] SSE request error:`, err.message);
        if (!res.headersSent) {
          res.writeHead(502);
          res.end('Bad Gateway');
        }
      });
      
      // Forward request body if any
      req.pipe(proxyReq);
      
      return; // STOP execution here so we don't trigger the timeouts below
    }
    
    // ... [KEEP YOUR MANUAL BUFFERING BLOCK FOR STATIC ASSETS HERE] ...
    if (isStaticAsset) {
        // (Copy your existing static asset logic here)
        // ...
        // Ensure you return; at the end of this block too
        
        // Placeholder for brevity, paste your existing code:
        console.log(`[${ws.id}] Using manual proxy for static asset: ${req.url}`);
        // ... existing static asset logic ...
        // Make sure to `return;` inside the callback or at end of block
        // so the http-proxy logic below doesn't run.
        
        // --- FOR THIS EXAMPLE I AM ASSUMING YOU PASTE YOUR EXISTING STATIC LOGIC HERE ---
        // For the sake of the snippet to work, I will use your existing logic:
        const backendUrl = new URL(ws.backendUrl);
        const options: http.RequestOptions = {
            hostname: backendUrl.hostname,
            port: backendUrl.port || 80,
            path: req.url,
            method: req.method,
            headers: {
            ...req.headers,
            host: backendUrl.host,
            'x-forwarded-for': req.socket.remoteAddress || '',
            'x-forwarded-proto': 'https',
            'x-forwarded-host': host,
            },
            family: 6, 
        };
        const proxyReq = http.request(options, (proxyRes) => {
            const chunks: Buffer[] = [];
            let totalLength = 0;
            proxyRes.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
                totalLength += chunk.length;
            });
            proxyRes.on('end', () => {
                const fullResponse = Buffer.concat(chunks, totalLength);
                // ... (your existing mime type logic) ...
                res.writeHead(proxyRes.statusCode || 200, {
                    ...proxyRes.headers,
                    'content-length': totalLength.toString(),
                    'access-control-allow-origin': '*',
                });
                res.end(fullResponse);
            });
            // Error handling...
        });
        req.pipe(proxyReq);
        return; 
    }

    // =================================================================
    // Standard Proxy Logic (http-proxy)
    // =================================================================

    const proxy = getOrCreateProxy(ws.id);
    
    proxy.removeAllListeners("proxyReq");
    proxy.removeAllListeners("error");
    proxy.removeAllListeners("proxyRes");

    proxy.on("proxyReq", (proxyReq: any, req: any) => {
      // ... [Keep your existing header logic] ...
      if (!ws.serverOnly && userId) proxyReq.setHeader("X-Auth-User", userId);
      if (req.headers.cookie) proxyReq.setHeader("Cookie", req.headers.cookie);
      proxyReq.setHeader("Connection", "close"); // Standard requests close
      // ...
    });

    // ... [Keep your existing proxy event handlers] ...
    
    // 6. ONLY APPLY TIMEOUTS IF NOT SSE
    // This is the fix. We only set the timeout for standard API calls.
    if (req.socket) {
        req.socket.setTimeout(120000); 
        req.socket.setKeepAlive(true, 1000);
    }
    if (res.socket) {
        res.socket.setTimeout(120000);
        res.socket.setKeepAlive(true, 1000);
    }

    // Standard Agent setup
    const backendUrl = new URL(ws.backendUrl);
    const isHttps = backendUrl.protocol === 'https:';
    const agent = isHttps 
      ? new https.Agent({ family: 6, keepAlive: true })
      : new http.Agent({ family: 6, keepAlive: true });

    proxy.web(req, res, { 
      target: ws.backendUrl,
      agent: agent 
    });
    
  } catch (error) {
    console.error("Request handler error:", error);
    if (!res.headersSent) {
      res.writeHead(500);
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

    let ws;
    try {
      ws = await internalClient.internal.getWorkspaceBySubdomain.query({ subdomain });
    } catch (error) {
      console.error(`[${subdomain}] Failed to fetch workspace:`, error);
      socket.destroy();
      return;
    }

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

      // Connect to backend WebSocket with IPv6 (Railway internal)
      const backendWs = new WebSocket(targetWsUrl, ["tty"], {
        headers: {
          "Host": backendUrl.host,
          "X-Forwarded-For": req.socket.remoteAddress,
          "X-Forwarded-Proto": "https",
          "X-Forwarded-Host": host,
          "User-Agent": req.headers["user-agent"] || "GitPad-Proxy/1.0",
          ...(req.headers.cookie ? { "Cookie": req.headers.cookie } : {}),
        },
        family: 6, // Force IPv6 for Railway
        rejectUnauthorized: false,
        perMessageDeflate: true,
        handshakeTimeout: 10000,
      });

      // Set up ping/pong for keepalive
      let pingInterval: NodeJS.Timeout;
      
      backendWs.on("open", () => {
        console.log(`[${ws.id}] Backend connection established!`);
        backendConnected = true;
        
        // Update heartbeat immediately when user connects
        updateWorkspaceHeartbeat(ws.id);
        
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
        }, 30000);
      });

      // Forward messages from client to backend
      clientWs.on("message", (data, isBinary) => {
        updateWorkspaceHeartbeat(ws.id);
        
        if (backendConnected && backendWs.readyState === WebSocket.OPEN) {
          backendWs.send(data, { binary: isBinary });
        } else if (!backendConnected) {
          messageBuffer.push({ data, isBinary });
          if (messageBuffer.length <= 5) {
            console.log(`[${ws.id}] Buffered message (${messageBuffer.length} total)`);
          }
        }
      });

      // Forward messages from backend to client
      backendWs.on("message", (data, isBinary) => {
        updateWorkspaceHeartbeat(ws.id);
        
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