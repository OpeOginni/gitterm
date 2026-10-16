export const T3_ORIGIN_BRIDGE_PATH = "~/.gitterm/t3-origin-bridge.cjs";

/**
 * Provider ingresses route by Host, but T3 verifies DPoP against Host (not
 * X-Forwarded-Host). Restore the provisioned public origin at the last hop.
 * This transport does not mint, inspect, or bypass any authentication tokens.
 * Keep the runtime self-contained: workspaces only need their existing Node.
 */
export function buildT3OriginBridgeSource(hostname: string): string {
  const protocol =
    /^(localhost|127\.0\.0\.1)(:|$)/.test(hostname) || hostname.includes(".localhost")
      ? "http:"
      : "https:";
  const origin = new URL(`${protocol}//${hostname}`);
  if (origin.host !== hostname || origin.pathname !== "/" || origin.username || origin.password) {
    throw new Error("Invalid T3 workspace hostname");
  }
  return `const publicOrigin = ${JSON.stringify(origin.origin)};
${T3_ORIGIN_BRIDGE_RUNTIME}`;
}

const T3_ORIGIN_BRIDGE_RUNTIME = String.raw`
const http = require("node:http");
const { spawn } = require("node:child_process");
const origin = new URL(publicOrigin);
const [binary, ...args] = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const hostIndex = args.indexOf("--host");
const port = Number(args[portIndex + 1]);
if (!binary || portIndex < 0 || hostIndex < 0 || !Number.isInteger(port) || port < 1 || port > 65534) {
  throw new Error("T3 origin bridge requires an explicit --host and --port");
}
const upstreamPort = port + 1;
args[portIndex + 1] = String(upstreamPort);
args[hostIndex + 1] = "127.0.0.1";

// Use only the provisioned origin, never client-supplied forwarding headers or
// JWT claims. In particular, a forged X-Forwarded-Host must not affect DPoP.
function options(request) {
  const headers = { ...request.headers, host: origin.host };
  delete headers.forwarded;
  headers["x-forwarded-host"] = origin.host;
  headers["x-forwarded-proto"] = origin.protocol.slice(0, -1);
  return { hostname: "127.0.0.1", port: upstreamPort, method: request.method,
    path: request.url, headers, agent: false };
}

const sockets = new Set();
const server = http.createServer((request, response) => {
  const upstream = http.request(options(request), (incoming) => {
    response.writeHead(incoming.statusCode, incoming.rawHeaders);
    incoming.pipe(response);
    incoming.on("error", () => response.destroy());
  });
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.on("aborted", () => upstream.destroy());
  request.on("error", () => upstream.destroy());
  response.on("error", () => upstream.destroy());
  response.on("close", () => upstream.destroy());
  request.pipe(upstream);
});
// Agent streams and terminal sessions can be long-lived.
server.requestTimeout = 0;
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
server.on("upgrade", (request, socket, head) => {
  const upstream = http.request(options(request));
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
  upstream.on("error", () => socket.destroy());
  upstream.on("response", (response) => {
    socket.end("HTTP/1.1 " + response.statusCode + " " + response.statusMessage + "\r\nConnection: close\r\n\r\n");
    response.resume();
  });
  upstream.on("upgrade", (response, peer, upstreamHead) => {
    socket.write("HTTP/1.1 " + response.statusCode + " " + response.statusMessage + "\r\n");
    for (let i = 0; i < response.rawHeaders.length; i += 2) {
      socket.write(response.rawHeaders[i] + ": " + response.rawHeaders[i + 1] + "\r\n");
    }
    socket.write("\r\n");
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) peer.write(head);
    peer.on("error", () => socket.destroy());
    socket.on("close", () => peer.destroy());
    peer.on("close", () => socket.destroy());
    socket.pipe(peer).pipe(socket);
  });
  upstream.end();
});

// The npm t3 launcher spawns the native executable. Own the whole process
// group so stopping the bridge cannot leave a live native server behind.
const child = spawn(binary, args, { stdio: "inherit", detached: true });
let stopping = false;
function stop(signal, exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  server.close();
  for (const socket of sockets) socket.destroy();
  function killGroup(signal) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  killGroup(signal);
  if (!child.pid) process.exit(exitCode);
  // npm's launcher can exit before native T3 finishes releasing its runtime
  // lock and port. Wait for the group, not just the launcher, before exiting.
  setInterval(() => {
    try { process.kill(-child.pid, 0); }
    catch (error) { if (error.code === "ESRCH") process.exit(exitCode); }
  }, 25);
  setTimeout(() => { killGroup("SIGKILL"); process.exit(exitCode); }, 5000);
}
process.on("SIGTERM", () => stop("SIGTERM", 0));
process.on("SIGINT", () => stop("SIGINT", 0));
child.on("error", (error) => { console.error("T3 launch failed:", error.message); stop("SIGTERM", 1); });
child.on("exit", (code) => stop("SIGTERM", code ?? 1));
server.on("error", (error) => { console.error("T3 origin bridge failed:", error.message); stop("SIGTERM", 1); });
server.listen(port, "0.0.0.0");
`;
