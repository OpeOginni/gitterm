/**
 * A stand-in for ttyd that speaks its protocol, for the page's browser tests: it records what
 * the page sends, and test routes make it send output, drop connections or refuse them.
 * `tests/session.ts` checks the page's assumptions against the real ttyd and tmux.
 */
import type { ServerWebSocket } from "bun";

type Socket = ServerWebSocket<{ upload?: string[] }>;
const agent = {
  name: "Test agent",
  keys: [
    { label: "Thinking", send: "\u001b[Z" },
    { label: "Model", send: "\u000c" },
  ],
};
let inputs: string[] = [];
let uploads: { args: string[]; data: string }[] = [];
let available = true;
const sockets = new Set<Socket>();
const text = (data: string | Buffer) => (typeof data === "string" ? data : data.toString());

Bun.serve<{ upload?: string[] }>({
  port: 17682,
  hostname: "127.0.0.1",
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const args = url.searchParams.getAll("arg");
      if (server.upgrade(req, { data: { upload: args[0] === "upload" ? args : undefined } }))
        return;
      return new Response("Upgrade failed", { status: 400 });
    }
    if (url.pathname === "/token") {
      return Response.json({ token: "" }, { status: available ? 200 : 503 });
    }
    if (url.pathname === "/test/state") return Response.json({ inputs, uploads });
    if (url.pathname === "/test/reset") {
      inputs = [];
      uploads = [];
      available = true;
      return Response.json({});
    }
    if (url.pathname === "/test/disconnect") {
      available = false;
      for (const socket of sockets) socket.close();
      return Response.json({});
    }
    if (url.pathname === "/test/online") {
      available = true;
      return Response.json({});
    }
    if (url.pathname === "/test/output") {
      for (const socket of sockets) socket.send(Buffer.from(`0${url.searchParams.get("data")}`));
      return Response.json({});
    }
    return new Response(Bun.file("dist/index.html"));
  },
  websocket: {
    open(socket) {
      if (!socket.data.upload) sockets.add(socket);
    },
    close(socket) {
      sockets.delete(socket);
    },
    message(socket, message) {
      const value = text(message);
      const upload = socket.data.upload;
      if (value.startsWith("{")) {
        socket.send(Buffer.from(`2${JSON.stringify({ gitterm: agent })}`));
        if (upload) socket.send(Buffer.from("0ready\n"));
        else socket.send(Buffer.from("0\x1b[?2004hAgent ready\r\n> "));
      } else if (value[0] === "0" && upload) {
        const entry = uploads.find((item) => item.args === upload);
        if (entry) entry.data += value.slice(1);
        else uploads.push({ args: upload, data: value.slice(1) });
        const total = uploads.find((item) => item.args === upload)!.data.length;
        if (total >= Number(upload[2]))
          socket.send(Buffer.from(`0\nsaved /home/u/.gitterm/uploads/1-${upload[1]}\n`));
      } else if (value[0] === "0") inputs.push(value.slice(1));
    },
  },
});
