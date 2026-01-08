# ttyd WebSocket Proxy Fix Documentation

## Problem Summary

The original proxy was only receiving 3 WebSocket messages when connecting to ttyd, preventing the full terminal UI from loading. This was caused by several critical issues in the WebSocket handling logic.

---

## Critical Fixes

### 1. **Fixed `serverMaxWindowBits` Configuration**

**Original Code:**

```typescript
serverMaxWindowBits: 1024, // WRONG!
```

**Fixed Code:**

```typescript
serverMaxWindowBits: 10, // Correct range: 8-15
```

**Why This Matters:**

- `serverMaxWindowBits` controls the LZ77 sliding window size for compression
- Valid range is **8-15** (representing 2^8 to 2^15 bytes)
- Setting it to 1024 is invalid and causes WebSocket compression to fail
- When compression fails, many WebSocket implementations will drop the connection or refuse to send compressed frames
- ttyd sends a lot of terminal data that benefits from compression, so this was likely causing frames to be silently dropped

---

### 2. **Added Message Buffering for Race Condition**

**The Problem:**

```typescript
// Original code - messages sent before backend connects are LOST
clientWs.on("message", (data, isBinary) => {
  if (backendWs.readyState === WebSocket.OPEN) {
    backendWs.send(data, { binary: isBinary });
  }
  // If backend isn't ready yet, message is dropped!
});
```

**The Fix:**

```typescript
const messageBuffer: Array<{ data: any; isBinary: boolean }> = [];
let backendConnected = false;

clientWs.on("message", (data, isBinary) => {
  if (backendConnected && backendWs.readyState === WebSocket.OPEN) {
    backendWs.send(data, { binary: isBinary });
  } else if (!backendConnected) {
    // Buffer messages until backend connects
    messageBuffer.push({ data, isBinary });
  }
});

backendWs.on("open", () => {
  backendConnected = true;
  // Flush buffered messages
  messageBuffer.forEach(({ data, isBinary }) => {
    backendWs.send(data, { binary: isBinary });
  });
  messageBuffer.length = 0;
});
```

**Why This Matters:**

- WebSocket connections aren't instant - there's a brief period between creating the backend WebSocket and it being ready
- During this time, the client might send initialization messages (terminal size, capabilities, etc.)
- Without buffering, these critical setup messages are **silently dropped**
- ttyd expects these initialization messages to configure the terminal session properly
- Missing these messages causes the terminal UI to fail initialization

**Timeline:**

```
t=0ms:   Client connects to proxy
t=1ms:   Proxy accepts client connection
t=2ms:   Client sends terminal size (80x24)
t=3ms:   Client sends terminal type (xterm-256color)
t=5ms:   Proxy creates backend WebSocket
t=50ms:  Backend WebSocket connects ← Messages sent at t=2-3ms are gone!
```

---

### 3. **Added Ping/Pong Keepalive**

**Added Code:**

```typescript
let pingInterval: NodeJS.Timeout;

backendWs.on("open", () => {
  // Start keepalive ping
  pingInterval = setInterval(() => {
    if (backendWs.readyState === WebSocket.OPEN) {
      backendWs.ping();
    }
  }, 30000); // Ping every 30 seconds
});

backendWs.on("pong", () => {
  // Backend is alive
});

clientWs.on("ping", () => {
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.pong();
  }
});
```

**Why This Matters:**

- Idle WebSocket connections can be closed by intermediate proxies, firewalls, or load balancers
- Many cloud providers (Cloudflare, AWS ALB, etc.) drop idle connections after 30-60 seconds
- Terminal sessions are often idle (user reading output, thinking, etc.)
- Without keepalive, the connection dies during idle periods, causing the UI to freeze
- Ping/pong frames keep the connection alive and detect dead connections quickly

---

### 4. **Improved Connection State Handling**

**Original Code:**

```typescript
const closeBoth = () => {
  if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  if (backendWs.readyState === WebSocket.OPEN) backendWs.close();
};
```

**Fixed Code:**

```typescript
const closeBoth = () => {
  if (pingInterval) {
    clearInterval(pingInterval);
  }

  if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
    clientWs.close();
  }

  if (backendWs.readyState === WebSocket.OPEN || backendWs.readyState === WebSocket.CONNECTING) {
    backendWs.close();
  }
};
```

**Why This Matters:**

- WebSocket has 4 states: CONNECTING, OPEN, CLOSING, CLOSED
- Original code only closed OPEN connections, leaving CONNECTING connections hanging
- Hanging connections can prevent new connections and leak resources
- Properly cleaning up the ping interval prevents memory leaks

---

### 5. **Enhanced Headers for Backend Connection**

**Added Code:**

```typescript
const backendWs = new WebSocket(targetWsUrl, ["tty"], {
  headers: {
    Host: backendUrl.host, // Proper virtual host routing
    "X-Forwarded-For": req.socket.remoteAddress,
    "X-Forwarded-Proto": "https",
    "X-Forwarded-Host": host,
    "User-Agent": req.headers["user-agent"] || "gitterm-Proxy/1.0",
    ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
  },
  rejectUnauthorized: false,
  perMessageDeflate: true, // Enable compression
});
```

**Why This Matters:**

- **`Host` header**: Required for proper virtual host routing on the backend
- **`User-Agent`**: Some servers reject connections without a User-Agent
- **`perMessageDeflate: true`**: Enables compression on the backend connection (must match server settings)
- **Cookie forwarding**: Preserves session authentication if ttyd uses cookies

---

## 6. IPv6 and Internal Networking

To enable secure, private communication between services within Railway (Proxy ↔ Workspace), we moved to IPv6 and internal DNS.

### The Change

- **Bind Address**: Changed from `0.0.0.0` (IPv4) to `::` (IPv6 + IPv4 dual-stack).
- **Internal DNS**: Using `*.railway.internal` domains instead of public `*.up.railway.app` or custom domains.

### Why This Matters

1.  **Private Networking**: Railway's private network allows services to communicate securely without exposing ports to the public internet.
2.  **IPv6 Support**: Railway's internal network infrastructure relies heavily on IPv6. Binding to `::` ensures the application listens on the correct interfaces for internal traffic.
3.  **Performance & Security**: Internal traffic doesn't leave the datacenter and isn't subject to public internet latency or security risks.
4.  **DNS Resolution**: `ws-uuid.railway.internal` resolves to the private IP of the service, bypassing public DNS propagation.

---

## How WebSocket Compression Works

Understanding why `serverMaxWindowBits` was critical:

### LZ77 Compression in WebSockets

- WebSockets use DEFLATE compression (LZ77 + Huffman coding)
- The "window" is a sliding buffer of recently seen data
- `serverMaxWindowBits` sets the window size: 2^n bytes
- Valid range: 8-15 (256 bytes to 32 KB)

### Why Invalid Settings Break Everything

1. During WebSocket handshake, client and server negotiate compression parameters
2. If server advertises invalid `serverMaxWindowBits` (like 1024), the negotiation fails
3. Many WebSocket implementations silently fall back to **no compression**
4. Some implementations reject the connection entirely
5. ttyd sends large payloads (terminal output, ANSI escape codes) that exceed frame size limits without compression
6. Oversized frames are rejected, resulting in only a few small messages getting through

---

## The Complete Message Flow

### Before the Fix:

```
1. Client connects → Proxy accepts
2. Client sends: terminal size [LOST - backend not ready]
3. Client sends: terminal type [LOST - backend not ready]
4. Backend connects
5. Backend sends: prompt
6. Client receives: incomplete terminal (only 3 messages total)
```

### After the Fix:

```
1. Client connects → Proxy accepts
2. Client sends: terminal size [BUFFERED]
3. Client sends: terminal type [BUFFERED]
4. Backend connects
5. Proxy sends buffered: terminal size → Backend
6. Proxy sends buffered: terminal type → Backend
7. Backend sends: full terminal initialization
8. Backend sends: prompt
9. Backend sends: ANSI control codes
10. Client receives: complete terminal UI (many messages)
11. Keepalive pings maintain connection during idle periods
```

---

## Key Takeaways

1. **WebSocket compression settings must be valid** - invalid settings break frame transmission
2. **Always buffer early messages** - WebSocket connections aren't instant
3. **Implement keepalive** - prevent idle connection timeouts
4. **Clean up all connection states** - not just OPEN, but CONNECTING too
5. **Forward proper headers** - backend servers may require specific headers
6. **Enable compression on both sides** - client↔proxy and proxy↔backend
7. **Support IPv6** - Modern cloud internal networks (like Railway) prioritize IPv6

---

## Testing the Fix

To verify the proxy is working correctly:

1. **Check WebSocket frame count** in browser DevTools → Network → WS tab
2. **Look for these frame types:**
   - Binary frames (terminal output)
   - Text frames (JSON control messages)
   - Ping/Pong frames (keepalive)
3. **Expected behavior:**
   - Initial burst of 20-50 frames (terminal initialization)
   - Continuous frames during interaction
   - Periodic ping frames every 30 seconds

---

## Common ttyd WebSocket Requirements

ttyd has specific WebSocket requirements that this proxy now satisfies:

1. **Protocol negotiation**: Must accept "tty" subprotocol
2. **Binary frames**: Terminal data is sent as binary
3. **Compression**: Large terminal outputs require compression
4. **Quick initialization**: Client must send terminal size immediately
5. **Keepalive**: Long-running terminal sessions need connection maintenance
6. **IPv6 Support**: Must bind to `::` to work within private networks
