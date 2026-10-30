import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

/**
 * A loopback-only proxy for a private preview. Local tools (for example browser
 * automation the user approved) open `url`; the proxy adds the sandbox access headers, so
 * they are never shown to a model or pasted into a browser.
 *
 * Each preview is served from its own hostname, `p-<random>.localhost`, which browsers and
 * Node resolve to loopback. Cookies are scoped by host (not port), so a separate hostname
 * keeps the preview's cookies, and its JavaScript, apart from every other local app and
 * other previews, while the app's own cookie names keep working. Paths start at `/`, so
 * root-relative assets and client-side routes work. The capability token in `url` is
 * exchanged for an HttpOnly cookie on first use; requests without it, or for any other
 * Host, are refused. The proxy lives only as long as this process. No WebSockets.
 */
export type PreviewProxy = { url: string; close(): Promise<void> };

const TOKEN_PARAM = "gitterm_preview_token";
const COOKIE = "gitterm_preview";
const TOKEN_FORMAT = /^[0-9a-f]{48}$/;

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

function cookies(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) result.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return result;
}

export async function startPreviewProxy(access: {
  url: string;
  headers: Record<string, string>;
}): Promise<PreviewProxy> {
  const upstream = new URL(access.url);
  const token = randomBytes(24).toString("hex");
  const hostname = `p-${randomBytes(8).toString("hex")}.localhost`;
  // Untrusted input: check the format before a constant-time comparison of equal lengths.
  const matches = (value: string | null | undefined) =>
    !!value && TOKEN_FORMAT.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  // Provider access cookies (e.g. Boat's `_port_auth`) are merged with the app's own.
  const { cookie: accessCookie, ...accessHeaders } = access.headers;
  let expectedHost = "";

  async function handle(request: IncomingMessage, response: ServerResponse) {
    // Only this preview's hostname: not 127.0.0.1, `localhost`, or another preview.
    if (request.headers.host?.toLowerCase() !== expectedHost) {
      response.writeHead(421).end();
      return;
    }
    const local = new URL(request.url ?? "/", `http://${expectedHost}`);
    const jar = cookies(request.headers.cookie);
    if (matches(local.searchParams.get(TOKEN_PARAM))) {
      local.searchParams.delete(TOKEN_PARAM);
      response.writeHead(303, {
        "set-cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
        location: `${local.pathname}${local.search}`,
      });
      response.end();
      return;
    }
    if (!matches(jar.get(COOKIE))) {
      response.writeHead(401).end();
      return;
    }
    jar.delete(COOKIE);
    // Only the path and query change; the authority always stays the provider's. A path
    // that normalizes to `//other-host/...` must not become a different host.
    const target = new URL(upstream.href);
    target.pathname = local.pathname;
    target.search = local.search;
    if (target.origin !== upstream.origin) {
      response.writeHead(400).end();
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    for (const [key, value] of Object.entries(accessHeaders)) headers.set(key, value);
    const forwarded = [...[...jar].map(([name, value]) => `${name}=${value}`), accessCookie].filter(
      Boolean,
    );
    if (forwarded.length) headers.set("cookie", forwarded.join("; "));
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
    const responseHeaders: Record<string, string | string[]> = {};
    upstreamResponse.headers.forEach((value, key) => {
      if (
        !HOP_BY_HOP.has(key) &&
        key !== "content-encoding" &&
        key !== "content-length" &&
        key !== "set-cookie"
      )
        responseHeaders[key] = value;
    });
    // Host-only on the preview's hostname: a provider `Domain` would not apply here.
    const setCookies = upstreamResponse.headers.getSetCookie();
    if (setCookies.length)
      responseHeaders["set-cookie"] = setCookies.map((cookie) =>
        cookie
          .split(";")
          .filter((part) => !/^\s*domain=/i.test(part))
          .join(";"),
      );
    const location = upstreamResponse.headers.get("location");
    if (location) {
      const resolved = new URL(location, target);
      if (resolved.origin === upstream.origin)
        responseHeaders.location = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    }
    response.writeHead(upstreamResponse.status, responseHeaders);
    if (upstreamResponse.body) Readable.fromWeb(upstreamResponse.body as never).pipe(response);
    else response.end();
  }

  // Any failure ends that one request; it never escapes into the hosting process.
  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  expectedHost = `${hostname}:${port}`;
  return {
    url: `http://${expectedHost}/?${TOKEN_PARAM}=${token}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
