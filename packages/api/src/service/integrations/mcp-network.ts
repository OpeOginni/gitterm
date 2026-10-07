import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import ipaddr from "ipaddr.js";
import { mcpEndpoint } from "@gitterm/schema/mcp";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

export class McpNetworkError extends Error {}

export function isPublicMcpAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export async function resolveMcpEndpoint(value: string) {
  const parsed = mcpEndpoint.safeParse(value);
  if (!parsed.success)
    throw new McpNetworkError("Use a public HTTPS MCP endpoint without embedded credentials");
  const url = new URL(parsed.data);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  let dnsTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        dnsTimeout = setTimeout(() => reject(new McpNetworkError("DNS lookup timed out")), 5000);
      }),
    ]);
  } catch {
    throw new McpNetworkError("The MCP hostname could not be resolved");
  } finally {
    clearTimeout(dnsTimeout);
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicMcpAddress(address))) {
    throw new McpNetworkError(
      "MCP endpoints must resolve to public addresses; private networks, localhost and cloud metadata are blocked",
    );
  }
  return { url, address: addresses[0]! };
}

/** Bounds multi-request metadata testing, not just each individual HTTP request. */
export function mcpFetchWithin(signal: AbortSignal): FetchLike {
  return (input, init) =>
    mcpFetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    });
}

/** DNS is validated AND pinned for the actual TLS connection.
 * Redirects are never followed, so credentials cannot leak to another origin.
 */
export const mcpFetch: FetchLike = async (input, init) => {
  const incoming = input instanceof Request ? input : undefined;
  const { url, address } = await resolveMcpEndpoint(incoming?.url ?? String(input));
  const headers = new Headers(init?.headers ?? incoming?.headers);
  const method = init?.method ?? incoming?.method ?? "GET";
  const signal = init?.signal ?? incoming?.signal;
  const source =
    init?.body ??
    (incoming && method !== "GET" && method !== "HEAD" ? await incoming.arrayBuffer() : undefined);
  let body: Uint8Array | string | undefined;
  if (source instanceof URLSearchParams) {
    body = source.toString();
    if (!headers.has("content-type"))
      headers.set("content-type", "application/x-www-form-urlencoded");
  } else if (typeof source === "string") body = source;
  else if (source instanceof ArrayBuffer) body = new Uint8Array(source);
  else if (ArrayBuffer.isView(source))
    body = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  else if (source != null) throw new McpNetworkError("Unsupported MCP request body");
  headers.set("accept-encoding", "identity");
  headers.delete("host");
  headers.delete("cookie");
  headers.delete("content-length");
  const outgoingHeaders: Record<string, string> = {};
  headers.forEach((value, name) => {
    outgoingHeaders[name] = value;
  });

  return new Promise<Response>((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method,
        headers: outgoingHeaders,
        agent: false,
        signal: signal ?? undefined,
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (res) => {
        clearTimeout(headerTimeout);
        const status = res.statusCode ?? 502;
        // Node accepts three-digit statuses outside the Fetch Response range.
        // Reject here: throwing in this asynchronous callback escapes the promise.
        if (status < 200 || status > 599) {
          res.destroy();
          reject(new McpNetworkError("The MCP endpoint returned an invalid HTTP status"));
          return;
        }
        if (status >= 300 && status < 400 && status !== 304) {
          res.destroy();
          reject(new McpNetworkError("The MCP endpoint redirected; use its final HTTPS URL"));
          return;
        }
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value !== undefined && name !== "set-cookie")
            responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        let received = 0;
        const stream = (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>).pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              received += chunk.byteLength;
              if (received > 16 * 1024 * 1024) {
                res.destroy();
                controller.error(new McpNetworkError("MCP response exceeded the 16 MiB limit"));
              } else controller.enqueue(chunk);
            },
          }),
        );
        // Stop stalled peers, but permit active SSE streams and long-running tools.
        res.setTimeout(5 * 60_000, () =>
          res.destroy(new McpNetworkError("MCP response timed out")),
        );
        const empty = [204, 205, 304].includes(status) || method === "HEAD";
        if (empty) res.resume();
        const response = new Response(empty ? null : stream, { status, headers: responseHeaders });
        Object.defineProperty(response, "url", { value: url.href });
        resolve(response);
      },
    );
    const headerTimeout = setTimeout(
      () => req.destroy(new McpNetworkError("MCP server did not respond within 30 seconds")),
      30_000,
    );
    req.on("error", (error) => {
      clearTimeout(headerTimeout);
      reject(new McpNetworkError("Could not reach the MCP server securely", { cause: error }));
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
};
