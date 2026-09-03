"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Cookie, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { acceptAll, rejectAll, setConsent, hasConsentDecision } from "@/lib/consent";
import { ANALYTICS_ENABLED } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * First-load cookie consent banner. Renders only when:
 *   1. analytics is wired up (`ANALYTICS_ENABLED`), and
 *   2. the user has not yet made a choice.
 *
 * If analytics keys are not configured (e.g. self-hosted) the banner
 * never appears because there's nothing to consent to.
 */
export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(true);

  useEffect(() => {
    if (!ANALYTICS_ENABLED) return;
    if (hasConsentDecision()) return;
    // Defer slightly so it doesn't flash before hydration.
    const t = window.setTimeout(() => setVisible(true), 200);
    return () => window.clearTimeout(t);
  }, []);

  if (!visible) return null;

  const handleAcceptAll = () => {
    acceptAll();
    setVisible(false);
  };

  const handleRejectAll = () => {
    rejectAll();
    setVisible(false);
  };

  const handleSavePrefs = () => {
    setConsent({ analytics: analyticsOn ? "granted" : "denied" });
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className={cn(
        "fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-[680px]",
        "rounded-xl border border-line bg-background/95 p-4 shadow-2xl backdrop-blur-xl sm:p-5",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-fill">
          <Cookie className="h-4 w-4 text-primary" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-4">Privacy</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={handleRejectAll}
              className="rounded-md p-1 text-fg-4 transition-colors hover:bg-fill hover:text-fg-2"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="mt-1.5 text-sm text-fg-2">
            We use cookies to keep you signed in and, with your permission, anonymous product
            analytics to improve GitTerm. We don't sell your data or run ads.
          </p>

          {showDetails ? (
            <div className="mt-4 space-y-3 rounded-lg border border-line bg-fill p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">Necessary</p>
                  <p className="text-xs text-fg-3">
                    Sign-in session, workspace access, and UI preferences. Required.
                  </p>
                </div>
                <span className="shrink-0 rounded-md border border-line bg-fill px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-3">
                  Always on
                </span>
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">Analytics</p>
                  <p className="text-xs text-fg-3">
                    Anonymous, aggregate usage data so we know which features matter.
                  </p>
                </div>
                <Switch
                  checked={analyticsOn}
                  onCheckedChange={setAnalyticsOn}
                  aria-label="Toggle analytics"
                />
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={handleAcceptAll}
              className="h-8 bg-primary px-3.5 font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
            >
              Accept all
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRejectAll}
              className="h-8 border-line bg-transparent px-3.5 font-mono text-xs uppercase tracking-wider text-fg-2 hover:border-line-2 hover:text-fg"
            >
              Reject optional
            </Button>
            {showDetails ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleSavePrefs}
                className="h-8 px-3.5 font-mono text-xs uppercase tracking-wider text-fg-2 hover:text-fg"
              >
                Save preferences
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => setShowDetails(true)}
                className="ml-1 font-mono text-[11px] uppercase tracking-wider text-fg-3 underline-offset-2 transition-colors hover:text-fg-2 hover:underline"
              >
                Customize
              </button>
            )}
            <Link
              href={"/privacy" as Route}
              className="ml-auto font-mono text-[11px] uppercase tracking-wider text-fg-4 underline-offset-2 transition-colors hover:text-fg-2 hover:underline"
            >
              Privacy policy
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
