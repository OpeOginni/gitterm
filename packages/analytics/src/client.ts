import { analyticsPath, eventProperties, type AnalyticsEvents } from "./policy";

export type { AnalyticsEvents, WorkspaceProperties } from "./policy";

/** Adapter boundary keeps the SDK out of the application's initial bundle. */
export interface AnalyticsAdapter {
  init: (key: string, host: string, hasConsent: () => boolean) => void;
  optIn: () => void;
  optOut: () => void;
  reset: () => void;
  identify: (userId: string | null) => void;
  capture: (event: string, properties: Record<string, unknown>) => void;
  captureException: (error: unknown) => void;
}

interface AnalyticsConfig {
  enabled: boolean;
  key?: string;
  host?: string;
  hasConsent: () => boolean;
  isBrowser?: () => boolean;
  loadAdapter?: () => Promise<AnalyticsAdapter>;
}

function safely(fn: () => void) {
  try {
    fn();
  } catch {
    /* Analytics never breaks the product. */
  }
}

/** No SDK import, persistence, queued events, or network requests while disabled. */
export function createAnalytics(config: AnalyticsConfig) {
  let adapter: AnalyticsAdapter | undefined;
  let loading: Promise<AnalyticsAdapter> | undefined;
  let initialized = false;
  let active = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  const isBrowser = config.isBrowser ?? (() => typeof window !== "undefined");
  const enabled = config.enabled && !!config.key && !!config.host;
  const hasPermission = () => {
    try {
      return enabled && isBrowser() && config.hasConsent();
    } catch {
      return false;
    }
  };
  const canTrack = () => active && initialized && hasPermission();
  const notify = () => listeners.forEach((listener) => listener());

  async function setConsent(granted: boolean) {
    const requestGeneration = ++generation;
    active = false;
    notify();
    if (!granted || !hasPermission()) {
      if (initialized && adapter) {
        safely(() => adapter!.optOut());
        safely(() => adapter!.reset());
      }
      return;
    }
    try {
      if (!adapter) {
        loading ??= (
          config.loadAdapter ??
          (() => import("@gitterm/analytics/adapter").then((module) => module.posthogAdapter))
        )();
        adapter = await loading;
      }
      // Consent can change while the separate SDK chunk is downloading.
      if (requestGeneration !== generation || !hasPermission()) return;
      if (!initialized) {
        adapter.init(config.key!, config.host!, hasPermission);
        initialized = true;
      } else {
        adapter.optIn();
      }
      active = true;
      notify();
    } catch {
      loading = undefined;
      active = false;
      notify();
    }
  }

  return {
    setConsent,
    canTrack,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    track<E extends keyof AnalyticsEvents>(event: E, properties: AnalyticsEvents[E]) {
      if (!canTrack()) return;
      safely(() =>
        adapter!.capture(event, { ...eventProperties(event, properties), schema_version: 2 }),
      );
    },
    identify(userId: string | null) {
      if (canTrack()) safely(() => adapter!.identify(userId));
    },
    captureException(error: unknown) {
      if (canTrack()) safely(() => adapter!.captureException(error));
    },
    pageview(pathname: string) {
      if (!canTrack()) return;
      const path = analyticsPath(pathname);
      safely(() =>
        adapter!.capture("$pageview", { $current_url: path, $pathname: path, schema_version: 2 }),
      );
    },
  };
}
