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
      // Validate session for non-public assets
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

    console.log(`[${ws.id}] ${req.method} ${req.url} -> ${ws.backendUrl}${req.url} (public: ${isPublicRequest})`);

    // Check if this is a large static asset that might have chunked encoding issues
    const isLargeAsset = req.url.includes('/assets/') && (req.url.endsWith('.js') || req.url.endsWith('.css'));
    
    if (isLargeAsset) {
      console.log(`[${ws.id}] Using manual proxy for large asset: ${req.url}`);
      
      // Manual proxy for large assets to avoid http-proxy chunked encoding issues
      const backendUrl = new URL(ws.backendUrl);
      const targetUrl = `${ws.backendUrl}${req.url}`;
      
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
        family: 6, // IPv6 for Railway
      };
      
      const proxyReq = http.request(options, (proxyRes) => {
        console.log(`[${ws.id}] Manual proxy response: ${proxyRes.statusCode} for ${req.url}`);
        console.log(`[${ws.id}] Response headers:`, JSON.stringify(proxyRes.headers));
        
        // CRITICAL FIX for Cloudflare: Buffer the entire response to calculate Content-Length
        // Cloudflare has issues with chunked encoding, especially for large assets
        const chunks: Buffer[] = [];
        let totalLength = 0;
        
        proxyRes.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          totalLength += chunk.length;
        });
        
        proxyRes.on('end', () => {
          console.log(`[${ws.id}] Buffered ${totalLength} bytes for ${req.url}`);
          
          // Combine all chunks
          const fullResponse = Buffer.concat(chunks, totalLength);
          
          // Prepare clean headers
          const headers: any = {
            'content-type': proxyRes.headers['content-type'] || 
              (req.url.endsWith('.js') ? 'application/javascript; charset=utf-8' : 
               req.url.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream'),
            'content-length': totalLength.toString(), // CRITICAL: Set proper Content-Length
            'cache-control': 'public, max-age=31536000',
            'access-control-allow-origin': '*',
          };
          
          // Copy safe headers from backend
          const safeHeaders = ['etag', 'last-modified', 'content-encoding', 'vary'];
          safeHeaders.forEach(h => {
            if (proxyRes.headers[h]) {
              headers[h] = proxyRes.headers[h];
            }
          });
          
          console.log(`[${ws.id}] Sending ${totalLength} bytes with Content-Length header`);
          
          // Send the response with proper Content-Length (no chunked encoding!)
          res.writeHead(proxyRes.statusCode || 200, headers);
          res.end(fullResponse);
          
          console.log(`[${ws.id}] Manual proxy complete: ${req.url}`);
        });
        
        proxyRes.on('error', (err) => {
          console.error(`[${ws.id}] Manual proxy stream error:`, err.message);
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });
      });
      
      proxyReq.on('error', (err) => {
        console.error(`[${ws.id}] Manual proxy request error:`, err.message);
        if (!res.headersSent) {
          res.writeHead(502);
          res.end('Bad Gateway');
        }
      });
      
      // Forward request body if any
      req.pipe(proxyReq);
      
      return; // Skip http-proxy for this request
    }

    // Get or create proxy for this workspace
    const proxy = getOrCreateProxy(ws.id);

    // Remove all old listeners to prevent memory leaks
    proxy.removeAllListeners("proxyReq");
    proxy.removeAllListeners("error");
    proxy.removeAllListeners("proxyRes");

    // Add auth and forwarding headers to proxied requests
    proxy.on("proxyReq", (proxyReq: any, req: any) => {
      if (!ws.serverOnly && userId) {
        proxyReq.setHeader("X-Auth-User", userId);
      }
      if (req.headers.cookie) {
        proxyReq.setHeader("Cookie", req.headers.cookie);
      }
      
      // CRITICAL: Force HTTP/1.0 to prevent chunked encoding issues
      // This makes the backend send Content-Length instead of chunked
      proxyReq.setHeader("Connection", "close");
      
      // Forward all important headers
      proxyReq.setHeader("X-Forwarded-For", req.socket.remoteAddress || req.connection.remoteAddress || "");
      proxyReq.setHeader("X-Forwarded-Proto", req.headers["x-forwarded-proto"] || "https");
      proxyReq.setHeader("X-Forwarded-Host", host);
      proxyReq.setHeader("X-Real-IP", req.socket.remoteAddress || "");
      
      // Preserve all original headers that matter
      const preserveHeaders = [
        "user-agent", "accept", "accept-language", "accept-encoding",
        "referer", "origin", "cache-control", "pragma", "if-none-match",
        "if-modified-since", "range", "content-type", "content-length"
      ];
      
      preserveHeaders.forEach(header => {
        if (req.headers[header]) {
          proxyReq.setHeader(header, req.headers[header]);
        }
      });
    });

    // Handle proxy errors with detailed logging
    proxy.on("error", (error: any, req: any, res: any) => {
      console.error(`[${ws.id}] ✗ Proxy error for ${req.method} ${req.url}:`, {
        message: error.message,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        backend: ws.backendUrl
      });
      
      if (!res.headersSent) {
        let statusCode = 502;
        let message = "Bad Gateway - Backend connection failed";
        
        if (error.code === "ECONNREFUSED") {
          statusCode = 503;
          message = "Service Unavailable - Backend refused connection";
        } else if (error.code === "ETIMEDOUT" || error.code === "ESOCKETTIMEDOUT") {
          statusCode = 504;
          message = "Gateway Timeout - Backend took too long to respond";
        } else if (error.code === "ENOTFOUND") {
          statusCode = 502;
          message = "Bad Gateway - Backend hostname not found";
        } else if (error.code === "ECONNRESET") {
          statusCode = 502;
          message = "Bad Gateway - Backend connection reset";
        }
        
        res.writeHead(statusCode, { "Content-Type": "text/plain" });
        res.end(message);
      }
    });

    // Log successful proxy responses
    proxy.on("proxyRes", (proxyRes: any, req: any, res: any) => {
      const contentLength = proxyRes.headers['content-length'];
      const transferEncoding = proxyRes.headers['transfer-encoding'];
      const isChunked = transferEncoding === 'chunked';
      
      console.log(`[${ws.id}] ✓ ${proxyRes.statusCode} ${req.method} ${req.url} (${contentLength || 'chunked'})`);
      
      // For chunked responses, ensure we don't timeout
      if (isChunked || !contentLength) {
        // Increase socket timeout for chunked transfers
        if (req.socket) {
          req.socket.setTimeout(120000); // 2 minutes
        }
        if (res.socket) {
          res.socket.setTimeout(120000);
        }
        
        console.log(`[${ws.id}] Chunked transfer for ${req.url}, extended timeouts`);
      }
      
      // DON'T add data listeners - let http-proxy handle the stream!
      // Just track completion events
      
      // Handle response errors (connection drops during transfer)
      proxyRes.on('error', (err: any) => {
        console.error(`[${ws.id}] Response stream error for ${req.url}:`, err.message);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("Bad Gateway - Response stream interrupted");
        } else {
          res.end();
        }
      });
      
      // Log when response completes
      proxyRes.on('end', () => {
        console.log(`[${ws.id}] ✓ Complete: ${req.url}`);
      });
      
      // Handle premature close
      proxyRes.on('close', () => {
        console.log(`[${ws.id}] Stream closed: ${req.url}`);
      });
    });

    // Handle response errors from client side
    res.on('error', (err: any) => {
      console.error(`[${ws.id}] Client response error for ${req.url}:`, err.message);
    });
    
    // Handle client closing connection early
    res.on('close', () => {
      if (!res.writableEnded) {
        console.warn(`[${ws.id}] Client closed connection early for ${req.url}`);
      }
    });
    
    // Monitor response finishing
    res.on('finish', () => {
      console.log(`[${ws.id}] Response finished for ${req.url}`);
    });
    
    // Increase request socket timeout
    if (req.socket) {
      req.socket.setTimeout(120000); // 2 minutes
      req.socket.setKeepAlive(true, 1000);
    }
    
    // Increase response socket timeout
    if (res.socket) {
      res.socket.setTimeout(120000);
      res.socket.setKeepAlive(true, 1000);
    }

    // Test backend connectivity before proxying
    const backendUrl = new URL(ws.backendUrl);
    console.log(`[${ws.id}] Target: ${backendUrl.protocol}//${backendUrl.host}`);
    
    // Create appropriate agent based on protocol with IPv6 support
    const isHttps = backendUrl.protocol === 'https:';
    const agent = isHttps 
      ? new https.Agent({
          family: 6,
          keepAlive: true,
          keepAliveMsecs: 1000,
          maxSockets: 50,
          rejectUnauthorized: false,
        })
      : new http.Agent({
          family: 6,
          keepAlive: true,
          keepAliveMsecs: 1000,
          maxSockets: 50,
        });

    // Forward HTTP request to backend
    proxy.web(req, res, { 
      target: ws.backendUrl,
      agent: agent 
    });
    
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