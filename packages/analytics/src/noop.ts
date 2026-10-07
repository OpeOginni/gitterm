import type { AnalyticsAdapter } from "./client";

const noop = () => {};

/** Build-time replacement for unconfigured self-hosted web deployments. No SDK imports. */
export const posthogAdapter: AnalyticsAdapter = {
  init: noop,
  optIn: noop,
  optOut: noop,
  reset: noop,
  identify: noop,
  capture: noop,
  captureException: noop,
};
