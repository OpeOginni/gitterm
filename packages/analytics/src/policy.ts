/** Deliberate product outcomes, not arbitrary UI clicks. Never add user content here. */
export interface AnalyticsEvents {
  auth_started: { method: "email" | "github" };
  auth_completed: { method: "email" | "github" };
  trial_started: { uses_default_repo: boolean };
  trial_succeeded: { duration_ms: number };
  trial_failed: { duration_ms: number; error_code: string };
  workspace_create_started: WorkspaceProperties;
  /** API request accepted; provisioning may still be pending. */
  workspace_create_succeeded: WorkspaceProperties & { duration_ms: number };
  workspace_create_failed: WorkspaceProperties & { duration_ms: number; error_code: string };
  /** Observed running in the browser's post-create subscription, not a server-wide SLA. */
  workspace_ready: { provider: string; agent: string; wait_ms: number };
  /** Handoff intent only: never use this as a count of connected agents or completed runs. */
  workspace_connection_requested: {
    provider: string;
    agent: string;
    method: "browser" | "desktop" | "cli" | "editor";
  };
  workspace_restarted: { provider: string; agent: string };
  model_provider_connected: { provider: string; auth_type: "api_key" | "oauth" };
  /** Persisted addition, not necessarily passing its connection test. Excludes edits. */
  integration_added: { integration_type: "github" | "google" | "mcp" | "executor" };
  checkout_started: {
    plan: "pro" | "growth";
    source: "pricing" | "settings_billing" | "settings_usage";
  };
  /** Browser return only. Payment/revenue must be verified by a billing webhook. */
  checkout_returned: { plan: "pro" | "growth" };
  bot_created: { platform: "slack" | "discord" };
}

export interface WorkspaceProperties {
  provider: string;
  agent: string;
  persistent: boolean;
  always_on: boolean;
  model_provider_count: number;
  integration_count: number;
}

// Runtime allowlist also prevents accidental content leakage from untyped call sites.
const workspaceKeys = [
  "provider",
  "agent",
  "persistent",
  "always_on",
  "model_provider_count",
  "integration_count",
];
export const EVENT_PROPERTIES: Record<keyof AnalyticsEvents, readonly string[]> = {
  auth_started: ["method"],
  auth_completed: ["method"],
  trial_started: ["uses_default_repo"],
  trial_succeeded: ["duration_ms"],
  trial_failed: ["duration_ms", "error_code"],
  workspace_create_started: workspaceKeys,
  workspace_create_succeeded: [...workspaceKeys, "duration_ms"],
  workspace_create_failed: [...workspaceKeys, "duration_ms", "error_code"],
  workspace_ready: ["provider", "agent", "wait_ms"],
  workspace_connection_requested: ["provider", "agent", "method"],
  workspace_restarted: ["provider", "agent"],
  model_provider_connected: ["provider", "auth_type"],
  integration_added: ["integration_type"],
  checkout_started: ["plan", "source"],
  checkout_returned: ["plan"],
  bot_created: ["platform"],
};

/** Routes are allowlisted: unknown paths and resource IDs never reach analytics. */
export function analyticsPath(value: string): string {
  try {
    const path = new URL(value, "https://analytics.invalid").pathname;
    const pathname = path.replace(/\/$/, "") || "/";
    if (/^\/dashboard\/bots\/[^/]+$/.test(pathname) && pathname !== "/dashboard/bots/new") {
      return "/dashboard/bots/:id";
    }
    if (
      /^\/(?:|login|pricing|privacy|terms|self-host|checkout\/success|dashboard|dashboard\/(?:compute|integrations|models|bots|bots\/new|settings(?:\/(?:account|agent-defaults|api|billing|history|privacy|providers|ssh|usage|workspace))?))\/?$/.test(
        pathname,
      )
    ) {
      return pathname.replace(/\/$/, "") || "/";
    }
  } catch {
    // Invalid URLs are not analytics dimensions.
  }
  return "/other";
}

export function analyticsErrorCode(error: unknown): string {
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  // Only transport categories; never send exception messages or provider response bodies.
  return typeof code === "string" &&
    [
      "BAD_REQUEST",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "TIMEOUT",
      "CONFLICT",
      "TOO_MANY_REQUESTS",
      "INTERNAL_SERVER_ERROR",
      "SERVICE_UNAVAILABLE",
    ].includes(code)
    ? code
    : "UNKNOWN";
}

export function eventProperties(event: keyof AnalyticsEvents, data: object) {
  const properties = data as Record<string, unknown>;
  return Object.fromEntries(
    EVENT_PROPERTIES[event].flatMap((key) => {
      const value = properties[key];
      return typeof value === "boolean" ||
        typeof value === "string" ||
        (typeof value === "number" && Number.isFinite(value))
        ? [[key, value]]
        : [];
    }),
  );
}

/** Sanitize automatic SDK metadata too, including initial person properties. */
export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) => {
      if (/title|search|hash|utm_|gclid|fbclid|msclkid/i.test(key)) return [];
      if ((key === "$set" || key === "$set_once") && value && typeof value === "object") {
        return [[key, sanitizeAnalyticsProperties(value as Record<string, unknown>)]];
      }
      if (/referr/i.test(key)) return []; // Referrer URLs can contain private paths and tokens.
      if (/url|pathname/i.test(key) && typeof value === "string") {
        return [[key, analyticsPath(value)]];
      }
      return [[key, value]];
    }),
  );
}
