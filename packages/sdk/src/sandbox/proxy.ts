import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

/**
 * A loopback-only proxy for a private preview. Local tools (for example browser
 * automation the user approved) open `url`; the proxy adds the sandbox access header,
 * so it is never shown to a model or pasted into a browser. The URL carries a random
 * capability path, and the proxy lives only as long as this process. No WebSockets.
 */
export type PreviewProxy = { url: string; close(): Promise<void> };

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "cookie",
]);

export async function startPreviewProxy(access: {
  url: string;
  headers: Record<string, string>;
}): Promise<PreviewProxy> {
  const upstream = new URL(access.url);
  const token = randomBytes(16).toString("hex");
  const prefix = `/gitterm-preview/${token}`;

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (!request.url?.startsWith(`${prefix}/`) && request.url !== prefix) {
      response.writeHead(404).end();
      return;
    }
    const target = new URL(request.url.slice(prefix.length) || "/", upstream);
    if (target.origin !== upstream.origin) {
      response.writeHead(400).end();
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    for (const [key, value] of Object.entries(access.headers)) headers.set(key, value);
    try {
      const body =
        request.method === "GET" || request.method === "HEAD" ? undefined : Readable.toWeb(request);
      const upstreamResponse = await fetch(target, {
        method: request.method,
        headers,
        body: body as BodyInit | undefined,
        redirect: "manual",
        // @ts-expect-error Node requires duplex for streamed request bodies.
        duplex: "half",
      });
      const responseHeaders: Record<string, string> = {};
      upstreamResponse.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key) && key !== "content-encoding" && key !== "content-length")
          responseHeaders[key] = value;
      });
      const location = upstreamResponse.headers.get("location");
      if (location) {
        const resolved = new URL(location, target);
        if (resolved.origin === upstream.origin)
          responseHeaders.location = `${prefix}${resolved.pathname}${resolved.search}`;
      }
      response.writeHead(upstreamResponse.status, responseHeaders);
      if (upstreamResponse.body) Readable.fromWeb(upstreamResponse.body as never).pipe(response);
      else response.end();
    } catch {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}${prefix}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
