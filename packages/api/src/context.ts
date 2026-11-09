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
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;

  const githubEvent = context.req.raw.headers.get("X-GitHub-Event");
  const githubInstallationTargetId = context.req.raw.headers.get(
    "X-GitHub-Hook-Installation-Target-ID",
  );
  const githubXHubSignature256 = context.req.raw.headers.get("x-hub-signature-256");

  const e2bSignature = context.req.raw.headers.get("e2b-signature");

  // Daytona (Svix) webhook signature headers, forwarded by the listener.
  // Svix emits either `svix-*` (default)
  const daytonaWebhookId = context.req.raw.headers.get("svix-id");
  const daytonaWebhookTimestamp = context.req.raw.headers.get("svix-timestamp");
  const daytonaWebhookSignature = context.req.raw.headers.get("svix-signature");
  const hasDaytonaWebhook =
    !!daytonaWebhookId && !!daytonaWebhookTimestamp && !!daytonaWebhookSignature;

  // boat signs deliveries with an HMAC over `delivery.timestamp.raw_body`.
  const boatWebhookDelivery = context.req.raw.headers.get("x-ascii-delivery");
  const boatWebhookTimestamp = context.req.raw.headers.get("x-ascii-timestamp");
  const boatWebhookSignature = context.req.raw.headers.get("x-ascii-signature");
  const hasBoatWebhook = !!boatWebhookDelivery && !!boatWebhookTimestamp && !!boatWebhookSignature;

  const rawBody =
    githubXHubSignature256 || e2bSignature || hasDaytonaWebhook || hasBoatWebhook
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
    boatWebhookDelivery,
    boatWebhookTimestamp,
    boatWebhookSignature,
    // Connection procedures set cache-control headers on sensitive responses.
    honoContext: context,
  };
}

export async function createListenerContext({ context }: CreateContextOptions) {
  const { auth } = await import("@gitterm/auth");
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });

  const internalApiKey = context.req.raw.headers.get("x-internal-key");
  const authHeader = context.req.raw.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;

  const githubEvent = context.req.raw.headers.get("X-GitHub-Event");
  const githubInstallationTargetId = context.req.raw.headers.get(
    "X-GitHub-Hook-Installation-Target-ID",
  );
  const githubXHubSignature256 = context.req.raw.headers.get("x-hub-signature-256");
  const e2bSignature = context.req.raw.headers.get("e2b-signature");

  // Daytona webhooks are delivered via Svix and carry these headers.
  // Svix emits either `svix-*` (default) or `webhook-*` (white-labeled) headers.
  const daytonaWebhookId =
    context.req.raw.headers.get("webhook-id") ?? context.req.raw.headers.get("svix-id");
  const daytonaWebhookTimestamp =
    context.req.raw.headers.get("webhook-timestamp") ??
    context.req.raw.headers.get("svix-timestamp");
  const daytonaWebhookSignature =
    context.req.raw.headers.get("webhook-signature") ??
    context.req.raw.headers.get("svix-signature");
  const hasDaytonaWebhook =
    !!daytonaWebhookId && !!daytonaWebhookTimestamp && !!daytonaWebhookSignature;

  // boat signs deliveries with an HMAC over `delivery.timestamp.raw_body`.
  const boatWebhookDelivery = context.req.raw.headers.get("x-ascii-delivery");
  const boatWebhookTimestamp = context.req.raw.headers.get("x-ascii-timestamp");
  const boatWebhookSignature = context.req.raw.headers.get("x-ascii-signature");
  const hasBoatWebhook = !!boatWebhookDelivery && !!boatWebhookTimestamp && !!boatWebhookSignature;

  const rawBody =
    githubXHubSignature256 || e2bSignature || hasDaytonaWebhook || hasBoatWebhook
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
    boatWebhookDelivery,
    boatWebhookTimestamp,
    boatWebhookSignature,
    honoContext: context,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
