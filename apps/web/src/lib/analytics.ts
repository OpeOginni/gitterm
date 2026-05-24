/**
 * PostHog analytics helpers.
 *
 * Tracking is opt-in via env (`NEXT_PUBLIC_POSTHOG_KEY` +
 * `NEXT_PUBLIC_POSTHOG_HOST`) AND only runs in production. Self-hosters who
 * don't set these vars get a complete no-op — PostHog never initializes,
 * no events fire, no outbound requests.
 *
 * Initialization happens once in `components/posthog-provider.tsx`.
 */

import env from "@gitterm/env/web";
import posthog from "posthog-js";

export const POSTHOG_KEY = env.NEXT_PUBLIC_POSTHOG_KEY;
export const POSTHOG_HOST = env.NEXT_PUBLIC_POSTHOG_HOST;

export const ANALYTICS_ENABLED =
  process.env.NODE_ENV === "production" && !!POSTHOG_KEY && !!POSTHOG_HOST;

export function track(event: string, data?: Record<string, string | number | boolean | undefined>) {
  if (!ANALYTICS_ENABLED) return;
  if (typeof window === "undefined") return;
  try {
    posthog.capture(event, data);
  } catch {
    // Swallow — analytics must never break the app.
  }
}

/* ── Event names (typed constants) ──────────────────────────────────── */

export const AnalyticsEvent = {
  AnonTryLaunch: "anon_try_launch",
  AnonTryKill: "anon_try_kill",
  WorkspaceCreate: "workspace_create",
  SignIn: "sign_in",
  GitHubSignInInitiated: "github_sign_in_initiated",
  CheckoutCompleted: "checkout_completed",
  UpgradeInitiated: "upgrade_initiated",
  AgentLoopCreated: "agent_loop_created",
  FeedbackSubmitted: "feedback_submitted",
  AccountDeleted: "account_deleted",
  GitHubConnected: "github_connected",
  GitHubDisconnected: "github_disconnected",
  ApiKeySaved: "api_key_saved",
  CustomerPortalOpened: "customer_portal_opened",
  CreateInstanceDialogOpened: "create_instance_dialog_opened",
} as const;
