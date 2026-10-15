import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { WebSocketServer } from "ws";
let inputs = [];
let sizes = [];
let tokenRequests = 0;
let available = true;
let readonly = false;
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/token") {
    tokenRequests++;
    res.writeHead(available ? 200 : 503);
    res.end(JSON.stringify({ token: "" }));
  } else if (req.url === "/test/state") res.end(JSON.stringify({ inputs, sizes, tokenRequests }));
  else if (req.url === "/test/reset") {
    inputs = [];
    sizes = [];
    tokenRequests = 0;
    available = true;
    readonly = false;
    res.end("{}");
  } else if (req.url === "/test/disconnect") {
    available = false;
    for (const ws of wss.clients) ws.close();
    res.end("{}");
  } else if (req.url === "/test/readonly") {
    readonly = true;
    res.end("{}");
  } else if (req.url === "/test/online") {
    available = true;
    res.end("{}");
  } else if (req.url.startsWith("/test/output?")) {
    const output = new URL(req.url, "http://localhost").searchParams.get("data");
    for (const ws of wss.clients) ws.send(Buffer.from("0" + output));
    res.end("{}");
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(await readFile("dist/index.html"));
  }
});
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  ws.on("message", (buffer) => {
    const value = buffer.toString();
    if (value.startsWith("{")) {
      sizes.push(JSON.parse(value));
      ws.send(Buffer.from(`2${JSON.stringify({ disableStdin: readonly })}`));
      ws.send(Buffer.from("0\x1b[?2004hTerminal ready\r\n$ "));
    } else if (value[0] === "0") inputs.push(value.slice(1));
    else if (value[0] === "1") sizes.push(JSON.parse(value.slice(1)));
  });
});
server.listen(17682, "127.0.0.1");
