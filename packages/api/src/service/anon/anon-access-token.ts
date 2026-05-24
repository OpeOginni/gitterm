import { createHmac, timingSafeEqual } from "crypto";
import env from "@gitterm/env/server";

/**
 * Stateless access tokens for the anonymous "try gitterm" flow.
 *
 * The proxy edge (`routers/proxy/index.ts`) calls `verifyAnonAccessToken` to
 * decide whether to forward a request to a workspace owned by a synthetic
 * anon user. The token is short-lived (10 min, matching the sandbox lease)
 * and bound to a single subdomain so a leaked cookie can't be replayed
 * against another anon workspace.
 *
 * Format: `<subdomain>.<exp>.<workspaceId>.<sig>` where:
 *   subdomain   = workspace.subdomain (immutable per workspace)
 *   exp         = Unix seconds when the token expires
 *   workspaceId = workspace.id, lets us fail fast on subdomain reuse
 *   sig         = HMAC-SHA256 of "<subdomain>.<exp>.<workspaceId>" using
 *                 BETTER_AUTH_SECRET, base64url-encoded
 *
 * No JWT framework — too much weight for a 4-field claim.
 */

export const ANON_COOKIE_NAME = "gitterm_anon";
export const ANON_TOKEN_TTL_SECONDS = 10 * 60;

function getSecret(): string {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET must be configured to issue anon access tokens");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export interface SignedAnonToken {
  token: string;
  expiresAt: Date;
}

export function signAnonAccessToken(params: {
  subdomain: string;
  workspaceId: string;
  ttlSeconds?: number;
}): SignedAnonToken {
  const ttl = params.ttlSeconds ?? ANON_TOKEN_TTL_SECONDS;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const body = `${params.subdomain}.${exp}.${params.workspaceId}`;
  const sig = sign(body);
  return {
    token: `${body}.${sig}`,
    expiresAt: new Date(exp * 1000),
  };
}

export interface VerifiedAnonToken {
  subdomain: string;
  workspaceId: string;
  exp: number;
}

export function verifyAnonAccessToken(
  token: string,
  expectedSubdomain: string,
): VerifiedAnonToken | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [subdomain, expStr, workspaceId, providedSig] = parts as [string, string, string, string];

  if (subdomain !== expectedSubdomain) return null;

  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  const expectedSig = sign(`${subdomain}.${expStr}.${workspaceId}`);
  // timingSafeEqual requires equal-length buffers
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { subdomain, workspaceId, exp };
}

/**
 * Read the anon cookie out of a Cookie header. Returns the raw token value or
 * null. Doesn't verify; pair with `verifyAnonAccessToken`.
 */
export function readAnonCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";");
  for (const c of cookies) {
    const idx = c.indexOf("=");
    if (idx < 0) continue;
    const name = c.slice(0, idx).trim();
    if (name === ANON_COOKIE_NAME) {
      return c.slice(idx + 1).trim();
    }
  }
  return null;
}

/**
 * Build the `Set-Cookie` header value for an anon access token. Scoped to the
 * parent domain so it travels to `<subdomain>.<BASE_DOMAIN>` requests.
 */
export function buildAnonCookieHeader(params: { token: string; ttlSeconds: number }): string {
  const baseDomain = env.BASE_DOMAIN;
  const isLocal = baseDomain.includes("localhost") || baseDomain.includes("127.0.0.1");
  const isSubdomainRouting = env.ROUTING_MODE === "subdomain";

  const attrs = [
    `${ANON_COOKIE_NAME}=${params.token}`,
    `Max-Age=${params.ttlSeconds}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (!isLocal) {
    attrs.push("Secure");
  }

  // Cross-subdomain cookie so the workspace subdomain receives it. In path
  // routing mode the workspace lives at the same origin, so a host cookie is
  // sufficient and we skip the Domain attribute.
  if (isSubdomainRouting && !isLocal) {
    attrs.push(`Domain=.${baseDomain.replace(/^\./, "")}`);
  }

  return attrs.join("; ");
}

/**
 * Expire the anon cookie (defensive — used when an anon session is reset).
 */
export function buildAnonCookieClearHeader(): string {
  return buildAnonCookieHeader({ token: "", ttlSeconds: 0 });
}
