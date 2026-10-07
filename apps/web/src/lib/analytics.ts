/**
 * PostHog analytics helpers.
 *
 * Tracking is opt-in via env (`NEXT_PUBLIC_POSTHOG_KEY` +
 * `NEXT_PUBLIC_POSTHOG_HOST`) AND only runs in production. Self-hosters who
 * don't set these vars get a complete no-op — PostHog never initializes,
 * no events fire, no outbound requests.
 *
 * The web layer supplies deployment configuration and consent. The event
 * schema, privacy policy, and lazy SDK adapter live in `@gitterm/analytics`.
 */

import env from "@gitterm/env/web";
import { useSyncExternalStore } from "react";
import { getConsent } from "@/lib/consent";
import { createAnalytics } from "@gitterm/analytics";
import type { AnalyticsEvents } from "@gitterm/analytics";

export const POSTHOG_KEY = env.NEXT_PUBLIC_POSTHOG_KEY;
export const POSTHOG_HOST = env.NEXT_PUBLIC_POSTHOG_HOST;

export const ANALYTICS_ENABLED =
  process.env.NODE_ENV === "production" && !!POSTHOG_KEY && !!POSTHOG_HOST;

export const analytics = createAnalytics({
  enabled: ANALYTICS_ENABLED,
  key: POSTHOG_KEY,
  host: POSTHOG_HOST,
  hasConsent: () => getConsent().analytics === "granted",
});
const serverSnapshot = () => false;

/** Mount-time outcomes must wait for consent hydration and SDK initialization. */
export function useAnalyticsReady() {
  return useSyncExternalStore(analytics.subscribe, analytics.canTrack, serverSnapshot);
}

export const canTrack = analytics.canTrack;
export const track = analytics.track;
export const captureException = analytics.captureException;

const AUTH_ATTEMPT_KEY = "gitterm:analytics-auth-method";
const INTEGRATION_ADDED_KEY = "gitterm:analytics-integration-added";

/** Preserve a consented callback outcome while the SDK loads and the router redirects. */
export function trackIntegrationAdded(
  integrationType: AnalyticsEvents["integration_added"]["integration_type"],
) {
  if (canTrack()) {
    track("integration_added", { integration_type: integrationType });
    return;
  }
  if (!ANALYTICS_ENABLED || typeof window === "undefined") return;
  try {
    if (getConsent().analytics !== "granted") return;
    sessionStorage.setItem(
      INTEGRATION_ADDED_KEY,
      JSON.stringify({ integrationType, addedAt: Date.now() }),
    );
  } catch {
    /* Storage may be disabled. */
  }
}

export function clearPendingIntegration() {
  try {
    sessionStorage.removeItem(INTEGRATION_ADDED_KEY);
  } catch {
    /* Storage may be disabled. */
  }
}

export function trackPendingIntegration() {
  if (!canTrack()) return;
  try {
    const pending = sessionStorage.getItem(INTEGRATION_ADDED_KEY);
    clearPendingIntegration();
    if (!pending) return;
    const { integrationType, addedAt } = JSON.parse(pending) as {
      integrationType?: unknown;
      addedAt?: unknown;
    };
    if (
      typeof addedAt !== "number" ||
      Date.now() - addedAt < 0 ||
      Date.now() - addedAt > 5 * 60 * 1000
    )
      return;
    if (
      integrationType === "github" ||
      integrationType === "google" ||
      integrationType === "mcp" ||
      integrationType === "executor"
    ) {
      track("integration_added", { integration_type: integrationType });
    }
  } catch {
    /* Storage may be disabled. */
  }
}

export function trackAuthStarted(method: "email" | "github") {
  if (!canTrack()) return;
  track("auth_started", { method });
  try {
    sessionStorage.setItem(AUTH_ATTEMPT_KEY, JSON.stringify({ method, startedAt: Date.now() }));
  } catch {
    /* Storage may be disabled. */
  }
}

export function clearAuthAttempt() {
  try {
    sessionStorage.removeItem(AUTH_ATTEMPT_KEY);
  } catch {
    /* Storage may be disabled. */
  }
}

export function trackAuthCompleted() {
  if (!canTrack()) return;
  try {
    const attempt = sessionStorage.getItem(AUTH_ATTEMPT_KEY);
    clearAuthAttempt();
    if (!attempt) return;
    const { method, startedAt } = JSON.parse(attempt) as { method?: unknown; startedAt?: unknown };
    if (
      typeof startedAt !== "number" ||
      Date.now() - startedAt < 0 ||
      Date.now() - startedAt > 30 * 60 * 1000
    )
      return;
    if (method === "email" || method === "github") track("auth_completed", { method });
  } catch {
    /* Storage may be disabled. */
  }
}
