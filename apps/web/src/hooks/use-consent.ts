"use client";

import { useEffect, useState } from "react";
import { CONSENT_EVENT, getConsent, hasConsentDecision, type ConsentState } from "@/lib/consent";

interface UseConsent {
  consent: ConsentState;
  decided: boolean;
  /** Whether SSR/CSR have reconciled. Use to avoid hydration flashes. */
  ready: boolean;
}

export function useConsent(): UseConsent {
  const [consent, setConsentState] = useState<ConsentState>({ analytics: "denied" });
  const [decided, setDecided] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConsentState(getConsent());
    setDecided(hasConsentDecision());
    setReady(true);

    const handler = () => {
      setConsentState(getConsent());
      setDecided(hasConsentDecision());
    };

    window.addEventListener(CONSENT_EVENT, handler);
    // Also react to changes from other tabs.
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener(CONSENT_EVENT, handler);
      window.removeEventListener("focus", handler);
    };
  }, []);

  return { consent, decided, ready };
}
