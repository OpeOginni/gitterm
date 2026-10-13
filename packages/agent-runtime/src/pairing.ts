import { call, createOpencodeClient, requestTimeout, type RuntimeConnection } from "./http";

/** Issue a code for a GUI, or redeem a separate code for a TUI. Never return the server password. */
export async function createOpencodeConnection(target: RuntimeConnection, kind: "link" | "tui") {
  const url = target.url.replace(/\/+$/, "");
  // OpenCode's pasted-link parser currently expects /auth/connect at the origin root.
  if (kind === "link" && new URL(url).pathname !== "/") {
    throw new Error(
      "Pairing links require a workspace subdomain. Use the server URL and password instead.",
    );
  }
  const client = createOpencodeClient(target);
  const pairing = await call(client.server.pair(requestTimeout()));
  const expiresAt = new Date(Date.now() + pairing.expires_in * 1_000).toISOString();
  if (kind === "link") {
    return { kind, url, link: `${url}/auth/connect/${pairing.code}`, expiresAt } as const;
  }
  const session = await call(client.server.connect({ code: pairing.code }, requestTimeout()));
  return { kind, url, token: session.token } as const;
}
