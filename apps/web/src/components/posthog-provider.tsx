"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { ANALYTICS_ENABLED, POSTHOG_HOST, POSTHOG_KEY } from "@/lib/analytics";
import { useConsent } from "@/hooks/use-consent";

/**
 * Initializes PostHog once on the client (after consent is granted) and
 * emits a `$pageview` on every client-side route change. Renders nothing.
 *
 * No-op when:
 *   - analytics is disabled (dev or env vars absent), or
 *   - the user has not granted analytics consent.
 *
 * If the user revokes consent later, we call `posthog.opt_out_capturing()`
 * so no further events leave the browser.
 */
export function PostHogProvider() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { consent, ready } = useConsent();
  const granted = consent.analytics === "granted";

  useEffect(() => {
    if (!ANALYTICS_ENABLED) return;
    if (!ready) return;
    if (typeof window === "undefined") return;

    const loaded = (posthog as unknown as { __loaded?: boolean }).__loaded === true;

    if (granted && !loaded) {
      posthog.init(POSTHOG_KEY!, {
        api_host: POSTHOG_HOST!,
        capture_pageview: false, // we drive pageviews manually below
        capture_pageleave: true,
        autocapture: false,
        person_profiles: "identified_only",
        opt_out_capturing_by_default: false,
      });
      return;
    }

    if (loaded) {
      if (granted) {
        posthog.opt_in_capturing();
      } else {
        posthog.opt_out_capturing();
      }
    }
  }, [granted, ready]);

  useEffect(() => {
    if (!ANALYTICS_ENABLED) return;
    if (!granted) return;
    if (!pathname) return;
    const url = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams, granted]);

  return null;
}
