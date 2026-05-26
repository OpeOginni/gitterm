/**
 * Cookie consent state.
 *
 * We persist the user's choice in a first-party cookie so it survives
 * across sessions and subdomains. We also dispatch a custom event so
 * components mounted on the same page can react instantly without a reload.
 *
 * Categories:
 *   - "necessary": always allowed. Sign-in session, anonymous workspace
 *      token, sidebar layout. Required for the app to function.
 *   - "analytics": optional. Product analytics (PostHog) used to understand
 *      feature usage and improve the product. No data is sold or shared
 *      with advertisers.
 */

export type ConsentValue = "granted" | "denied";

export interface ConsentState {
  analytics: ConsentValue;
}

export const CONSENT_COOKIE_NAME = "gitterm_consent";
const CONSENT_VERSION = "1";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const CONSENT_EVENT = "gitterm:consent-changed";

const DEFAULT_CONSENT: ConsentState = {
  analytics: "denied",
};

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function readCookie(name: string): string | null {
  if (!isBrowser()) return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : null;
}

function writeCookie(name: string, value: string) {
  if (!isBrowser()) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}

export function getConsent(): ConsentState {
  const raw = readCookie(CONSENT_COOKIE_NAME);
  if (!raw) return DEFAULT_CONSENT;
  try {
    const parsed = JSON.parse(raw) as { v?: string; analytics?: ConsentValue };
    if (parsed.v !== CONSENT_VERSION) return DEFAULT_CONSENT;
    return {
      analytics: parsed.analytics === "granted" ? "granted" : "denied",
    };
  } catch {
    return DEFAULT_CONSENT;
  }
}

export function hasConsentDecision(): boolean {
  return readCookie(CONSENT_COOKIE_NAME) !== null;
}

export function setConsent(state: ConsentState) {
  writeCookie(
    CONSENT_COOKIE_NAME,
    JSON.stringify({ v: CONSENT_VERSION, ...state }),
  );
  if (isBrowser()) {
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: state }));
  }
}

export function acceptAll() {
  setConsent({ analytics: "granted" });
}

export function rejectAll() {
  setConsent({ analytics: "denied" });
}
