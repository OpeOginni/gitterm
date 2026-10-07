import { createServerErrorTracking } from "@gitterm/analytics/server";

// Operational opt-in is independent of browser cookie consent. Never attach requests or users.
const errorTracking = createServerErrorTracking({
  enabled:
    process.env.NODE_ENV === "production" && process.env.POSTHOG_ERROR_TRACKING_ENABLED === "true",
  key: process.env.POSTHOG_PROJECT_KEY,
  host: process.env.POSTHOG_HOST,
});

export async function onRequestError(error: unknown) {
  if (process.env.NEXT_RUNTIME === "nodejs") await errorTracking.captureException(error);
}
