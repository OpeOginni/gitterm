"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { ANALYTICS_ENABLED, POSTHOG_HOST, POSTHOG_KEY } from "@/lib/analytics";

/**
 * Initializes PostHog once on the client and emits a `$pageview` on every
 * client-side route change. Renders nothing.
 *
 * No-op when analytics is disabled (dev, or env vars absent).
 */
export function PostHogProvider() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!ANALYTICS_ENABLED) return;
    if (typeof window === "undefined") return;
    if ((posthog as unknown as { __loaded?: boolean }).__loaded) return;

    posthog.init(POSTHOG_KEY!, {
      api_host: POSTHOG_HOST!,
      capture_pageview: false, // we drive pageviews manually below
      capture_pageleave: true,
      autocapture: false,
      person_profiles: "identified_only",
    });
  }, []);

  useEffect(() => {
    if (!ANALYTICS_ENABLED) return;
    if (!pathname) return;
    const url = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}
