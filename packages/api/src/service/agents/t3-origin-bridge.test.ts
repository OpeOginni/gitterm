import { expect, test } from "bun:test";
import { generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { buildT3OriginBridgeSource, T3_ORIGIN_BRIDGE_PATH } from "./t3-origin-bridge";
import { t3codeProvisioner } from "./t3code";

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

test("T3 receives a configured, immutable public origin", () => {
  const payload = t3codeProvisioner.provision({
    userId: "user",
    userDisplayName: "User",
    workspaceHostname: "ws.gitterm.dev",
    agentTypeName: "T3Code",
    serverOnly: true,
    credentials: [],
  });
  const file = payload.files.find((entry) => entry.path === T3_ORIGIN_BRIDGE_PATH)!;
  expect(Buffer.from(file.contentBase64, "base64").toString()).toContain(
    '"https://ws.gitterm.dev"',
  );
  expect(buildT3OriginBridgeSource("ws.localhost:8888")).toContain('"http://ws.localhost:8888"');
  expect(() => buildT3OriginBridgeSource("ws.gitterm.dev/path")).toThrow();
  expect(() => buildT3OriginBridgeSource("attacker@ws.gitterm.dev")).toThrow();
});

test("bridge preserves signed URLs, streaming, cookies, WebSockets, and shuts down T3", async () => {
  const root = await mkdtemp(join(tmpdir(), "gitterm-t3-origin-"));
  const portReservation = createServer();
  portReservation.listen(0, "127.0.0.1");
  await once(portReservation, "listening");
  const port = (portReservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => portReservation.close(() => resolve()));
  const upstream = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("Set-Cookie", ["session=one; HttpOnly", "other=two"]);
    res.end(
      JSON.stringify({
        url: `${req.headers["x-forwarded-proto"]}://${req.headers.host}${req.url}`,
        headers: req.headers,
        body,
      }),
    );
  });
  upstream.on("upgrade", (_req, socket, head) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  upstream.listen(port + 1, "127.0.0.1");
  await once(upstream, "listening");
  // Use a harmless child in place of native T3; the upstream fixture inspects
  // exactly what T3's HttpServerRequest.toURL and DPoP verifier receive.
  await writeFile(join(root, "bridge.cjs"), buildT3OriginBridgeSource("ws.gitterm.dev"));
  const pidPath = join(root, "native.pid");
  await writeFile(
    join(root, "child.cjs"),
    `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(() => {}, 1000);`,
  );
  const child = spawn(
    "node",
    [
      join(root, "bridge.cjs"),
      "node",
      join(root, "child.cjs"),
      "--host",
      "0.0.0.0",
      "--port",
      String(port),
    ],
    { stdio: "pipe" },
  );
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error("Bridge exited before readiness");
      const response = await fetch(`http://127.0.0.1:${port}/ready`).catch(() => null);
      if (response?.ok) {
        ready = true;
        break;
      }
      await Bun.sleep(20);
    }
    expect(ready).toBe(true);
    const publicUrl = "https://ws.gitterm.dev/oauth/token";
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const data = `${encode({ typ: "dpop+jwt", alg: "ES256", jwk: publicKey.export({ format: "jwk" }) })}.${encode({ htm: "POST", htu: publicUrl, iat: Math.floor(Date.now() / 1000), jti: randomUUID() })}`;
    const signature = sign("sha256", Buffer.from(data), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    const proof = `${data}.${signature.toString("base64url")}`;
    const response = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
      method: "POST",
      headers: {
        Host: "4096-box.boat.example",
        Authorization: "DPoP opaque-token",
        DPoP: proof,
        "X-Forwarded-Host": "attacker.invalid",
        "X-Forwarded-Proto": "http",
        Forwarded: "host=attacker.invalid",
        Cookie: "native=session",
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("subject_token=opaque"));
          controller.close();
        },
      }),
    });
    expect(response.headers.getSetCookie()).toEqual(["session=one; HttpOnly", "other=two"]);
    const received = (await response.json()) as {
      url: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(received.url).toBe(publicUrl);
    expect(received.headers.authorization).toBe("DPoP opaque-token");
    expect(received.headers.dpop).toBe(proof);
    expect(received.headers.cookie).toBe("native=session");
    expect(received.headers.forwarded).toBeUndefined();
    expect(received.headers["x-forwarded-host"]).toBe("ws.gitterm.dev");
    expect(received.body).toBe("subject_token=opaque");
    expect(
      verify("sha256", Buffer.from(data), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature),
    ).toBe(true);

    await new Promise<void>((resolve, reject) => {
      const req = request({
        hostname: "127.0.0.1",
        port,
        path: "/ws",
        headers: { Connection: "Upgrade", Upgrade: "websocket" },
      });
      req.setTimeout(2000, () => req.destroy(new Error("Upgrade timed out")));
      req.on("error", reject);
      req.on("upgrade", (_res, socket) => {
        socket.on("error", reject);
        socket.once("data", (frame) => {
          expect(frame.toString()).toBe("websocket-frame");
          socket.destroy();
          resolve();
        });
        socket.write("websocket-frame");
      });
      req.end();
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    const nativePid = Number(await readFile(pidPath, "utf8"));
    expect(() => process.kill(nativePid, 0)).toThrow();
    await rm(root, { recursive: true, force: true });
  }
  expect(child.exitCode).toBe(0);
}, 10_000);
