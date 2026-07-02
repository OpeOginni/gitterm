import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const { auth } = await import("@gitterm/auth");
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });

  // Extract internal API key for service-to-service auth
  const internalApiKey = context.req.raw.headers.get("x-internal-key");

  // Extract workspace JWT token from Authorization header
  const authHeader = context.req.raw.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.substring(7)
    : undefined;

  const githubEvent = context.req.raw.headers.get("X-GitHub-Event");
  const githubInstallationTargetId = context.req.raw.headers.get(
    "X-GitHub-Hook-Installation-Target-ID",
  );
  const githubXHubSignature256 = context.req.raw.headers.get(
    "x-hub-signature-256",
  );

  const e2bSignature = context.req.raw.headers.get("e2b-signature");

  // Daytona (Svix) webhook signature headers, forwarded by the listener.
  // Svix emits either `svix-*` (default)
  const daytonaWebhookId = context.req.raw.headers.get("svix-id");
  const daytonaWebhookTimestamp = context.req.raw.headers.get("svix-timestamp");
  const daytonaWebhookSignature = context.req.raw.headers.get("svix-signature");
  const hasDaytonaWebhook =
    !!daytonaWebhookId &&
    !!daytonaWebhookTimestamp &&
    !!daytonaWebhookSignature;

  const rawBody =
    githubXHubSignature256 || e2bSignature || hasDaytonaWebhook
      ? await context.req.text()
      : "";

  // Resolve the originating client IP (proxy hops). Falls back to the socket
  // address for local development. Used by the anonymous "try gitterm" flow
  // for IP-based rate limiting - never persisted raw, always hashed.
  const clientIp = resolveClientIp(context);

  return {
    session,
    internalApiKey,
    bearerToken,
    githubEvent,
    githubInstallationTargetId,
    githubXHubSignature256,
    rawBody,
    e2bSignature,
    daytonaWebhookId,
    daytonaWebhookTimestamp,
    daytonaWebhookSignature,
    clientIp,
    // The raw Hono context is exposed so a small set of procedures (e.g. the
    // anonymous try-gitterm flow) can append `Set-Cookie` headers. Most
    // procedures should not touch this - prefer typed return values.
    honoContext: context,
  };
}

function resolveClientIp(context: HonoContext): string | null {
  const xff = context.req.raw.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = context.req.raw.headers.get("x-real-ip");
  if (xri) return xri.trim();
  const cf = context.req.raw.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  // Hono's incoming request - try the underlying socket if present
  // (this is best-effort; in production we expect XFF from Caddy).
  const anyCtx = context as unknown as {
    env?: { incoming?: { socket?: { remoteAddress?: string } } };
  };
  return anyCtx.env?.incoming?.socket?.remoteAddress ?? null;
}

export async function createListenerContext({ context }: CreateContextOptions) {
  const { auth } = await import("@gitterm/auth");
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });

  const internalApiKey = context.req.raw.headers.get("x-internal-key");
  const authHeader = context.req.raw.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.substring(7)
    : undefined;

  const githubEvent = context.req.raw.headers.get("X-GitHub-Event");
  const githubInstallationTargetId = context.req.raw.headers.get(
    "X-GitHub-Hook-Installation-Target-ID",
  );
  const githubXHubSignature256 = context.req.raw.headers.get(
    "x-hub-signature-256",
  );
  const e2bSignature = context.req.raw.headers.get("e2b-signature");

  // Daytona webhooks are delivered via Svix and carry these headers.
  // Svix emits either `svix-*` (default) or `webhook-*` (white-labeled) headers.
  const daytonaWebhookId =
    context.req.raw.headers.get("webhook-id") ??
    context.req.raw.headers.get("svix-id");
  const daytonaWebhookTimestamp =
    context.req.raw.headers.get("webhook-timestamp") ??
    context.req.raw.headers.get("svix-timestamp");
  const daytonaWebhookSignature =
    context.req.raw.headers.get("webhook-signature") ??
    context.req.raw.headers.get("svix-signature");
  const hasDaytonaWebhook =
    !!daytonaWebhookId &&
    !!daytonaWebhookTimestamp &&
    !!daytonaWebhookSignature;

  const rawBody =
    githubXHubSignature256 || e2bSignature || hasDaytonaWebhook
      ? await context.req.text()
      : "";

  return {
    session,
    internalApiKey,
    bearerToken,
    githubEvent,
    githubInstallationTargetId,
    githubXHubSignature256,
    rawBody,
    e2bSignature,
    daytonaWebhookId,
    daytonaWebhookTimestamp,
    daytonaWebhookSignature,
    clientIp: null as string | null,
    honoContext: context,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
