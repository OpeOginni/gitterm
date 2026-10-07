// This module is loaded only after explicit consent on a configured deployment.
import { posthog } from "posthog-js";
import type { AnalyticsAdapter } from "./client";
import { EVENT_PROPERTIES, sanitizeAnalyticsProperties } from "./policy";
import { isUnexpectedError, sanitizeExceptionProperties } from "./errors";

export const posthogAdapter: AnalyticsAdapter = {
  init(key, host, hasConsent) {
    posthog.init(key, {
      api_host: host,
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_performance: false,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      error_tracking: { exception_steps: { enabled: false } },
      disable_session_recording: true,
      disable_surveys: true,
      save_referrer: false,
      advanced_disable_flags: true,
      ip: false,
      person_profiles: "identified_only",
      before_send: (event) => {
        if (!event || !hasConsent()) return null;
        if (event.event === "$exception") {
          // Cancelled fetches/navigation are expected, even when unhandled by a caller.
          if (
            Array.isArray(event.properties.$exception_list) &&
            event.properties.$exception_list[0]?.type === "AbortError"
          )
            return null;
          const sanitized = sanitizeExceptionProperties(event.properties);
          if (!sanitized) return null;
          event.properties = sanitized;
          return event;
        }
        if (
          event.event !== "$pageview" &&
          event.event !== "$identify" &&
          !Object.hasOwn(EVENT_PROPERTIES, event.event)
        )
          return null;
        event.properties = sanitizeAnalyticsProperties(event.properties);
        return event;
      },
    });
    // A previous visit may have persisted an opt-out. Current explicit consent wins.
    if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
  },
  optIn: () => {
    posthog.opt_in_capturing();
  },
  optOut: () => {
    posthog.opt_out_capturing();
  },
  reset: () => {
    posthog.reset();
  },
  identify(userId) {
    const previousUserId = posthog.get_property("$user_id");
    if (previousUserId && previousUserId !== userId) posthog.reset();
    if (userId && posthog.get_distinct_id() !== userId) posthog.identify(userId);
  },
  capture: (event, properties) => {
    posthog.capture(event, properties);
  },
  captureException(error) {
    if (isUnexpectedError(error))
      posthog.captureException(error, { service: "web", schema_version: 2 });
  },
};
