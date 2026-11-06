"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { acceptAll, rejectAll, hasConsentDecision } from "@/lib/consent";
import { ANALYTICS_ENABLED } from "@/lib/analytics";

/**
 * First-load cookie notice: a small card in the bottom-left corner. It shows only when analytics
 * is configured (`ANALYTICS_ENABLED`) and the visitor has not chosen yet, so self-hosted
 * deployments without analytics keys never see it. Analytics is the only optional category,
 * so two buttons cover every choice.
 */
export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ANALYTICS_ENABLED) return;
    if (hasConsentDecision()) return;
    // Defer slightly so it doesn't flash before hydration.
    const t = window.setTimeout(() => setVisible(true), 200);
    return () => window.clearTimeout(t);
  }, []);

  if (!visible) return null;

  const choose = (accept: boolean) => {
    if (accept) acceptAll();
    else rejectAll();
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed inset-x-4 bottom-4 z-[60] rounded-xl border border-line bg-card p-4 shadow-[0_16px_40px_rgba(0,0,0,0.45)] sm:right-auto sm:w-[360px]"
    >
      <p className="m-0 text-[14px] leading-[1.55] text-fg-2">
        We use cookies to keep you signed in. With your OK, we also use anonymous analytics to
        improve Gitterm.{" "}
        <Link
          href={"/privacy" as Route}
          className="text-fg underline decoration-line-2 underline-offset-[3px] hover:decoration-fg-3"
        >
          Privacy policy
        </Link>
      </p>
      <div className="mt-3.5 flex gap-2">
        <button
          type="button"
          onClick={() => choose(true)}
          className="h-8 rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-[#c09a45]"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => choose(false)}
          className="h-8 rounded-md bg-fill-2 px-3.5 text-[13px] font-medium text-fg-2 transition-colors hover:bg-line-2 hover:text-fg"
        >
          Only necessary
        </button>
      </div>
    </div>
  );
}
