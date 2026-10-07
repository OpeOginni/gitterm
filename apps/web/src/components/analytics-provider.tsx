"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  analytics,
  clearAuthAttempt,
  clearPendingIntegration,
  trackAuthCompleted,
  trackPendingIntegration,
  useAnalyticsReady,
} from "@/lib/analytics";
import { analyticsPath } from "@gitterm/analytics/policy";
import { authClient } from "@/lib/auth-client";
import { useConsent } from "@/hooks/use-consent";

/** The SDK lives in @gitterm/analytics and is lazy-loaded only after consent. */
export function AnalyticsProvider() {
  const pathname = usePathname();
  const { consent, ready } = useConsent();
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user.id;
  const granted = ready && consent.analytics === "granted";
  const analyticsReady = useAnalyticsReady();
  const lastPage = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    void analytics.setConsent(granted);
    if (!granted) {
      lastPage.current = null;
      clearAuthAttempt();
      clearPendingIntegration();
    }
  }, [granted, ready]);

  useEffect(() => {
    if (!analyticsReady || isPending) return;
    analytics.identify(userId ?? null);
    if (userId) trackAuthCompleted();
    trackPendingIntegration();
  }, [userId, isPending, analyticsReady]);

  useEffect(() => {
    if (!analyticsReady || !pathname || isPending) return;
    const path = analyticsPath(pathname);
    if (lastPage.current === path) return;
    lastPage.current = path;
    analytics.pageview(path);
  }, [pathname, analyticsReady, isPending]);

  return null;
}
