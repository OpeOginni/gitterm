import { describe, expect, mock, test } from "bun:test";
import { createAnalytics, type AnalyticsAdapter } from "./client";

function setup(
  options: { enabled?: boolean; key?: string; host?: string; browser?: boolean } = {},
) {
  let consent = false;
  const adapter: AnalyticsAdapter = {
    init: mock(() => {}),
    optIn: mock(() => {}),
    optOut: mock(() => {}),
    reset: mock(() => {}),
    identify: mock(() => {}),
    capture: mock(() => {}),
    captureException: mock(() => {}),
  };
  const loadAdapter = mock(async () => adapter);
  const analytics = createAnalytics({
    enabled: options.enabled ?? true,
    key: options.key ?? "test-key",
    host: options.host ?? "https://analytics.example.com",
    hasConsent: () => consent,
    isBrowser: () => options.browser ?? true,
    loadAdapter,
  });
  return {
    analytics,
    adapter,
    loadAdapter,
    consent: (value: boolean) => {
      consent = value;
    },
  };
}

describe("analytics lifecycle", () => {
  test("manual exceptions require initialization and current consent", async () => {
    const context = setup();
    const error = new Error("private");
    context.analytics.captureException(error);
    expect(context.adapter.captureException).not.toHaveBeenCalled();
    context.consent(true);
    await context.analytics.setConsent(true);
    context.analytics.captureException(error);
    expect(context.adapter.captureException).toHaveBeenCalledTimes(1);
    context.consent(false);
    context.analytics.captureException(error);
    expect(context.adapter.captureException).toHaveBeenCalledTimes(1);
  });
  test("treats unavailable consent storage as denied", async () => {
    const loadAdapter = mock(async () => setup().adapter);
    const analytics = createAnalytics({
      enabled: true,
      key: "key",
      host: "host",
      isBrowser: () => true,
      hasConsent: () => {
        throw new Error("storage unavailable");
      },
      loadAdapter,
    });
    await analytics.setConsent(true);
    expect(analytics.canTrack()).toBe(false);
    expect(loadAdapter).not.toHaveBeenCalled();
    expect(() => analytics.track("integration_added", { integration_type: "mcp" })).not.toThrow();
  });
  test.each([{ enabled: false }, { key: "" }, { host: "" }, { browser: false }])(
    "does not load the SDK when disabled: %j",
    async (options) => {
      const context = setup(options);
      context.consent(true);
      await context.analytics.setConsent(true);
      context.analytics.track("integration_added", { integration_type: "mcp" });
      context.analytics.identify("internal-user-id");
      context.analytics.pageview("/dashboard");
      expect(context.loadAdapter).not.toHaveBeenCalled();
      expect(context.adapter.capture).not.toHaveBeenCalled();
    },
  );

  test("does not initialize or queue events before consent", async () => {
    const context = setup();
    await context.analytics.setConsent(false);
    await context.analytics.setConsent(true); // Caller cannot override the persisted consent check.
    context.analytics.track("integration_added", { integration_type: "github" });
    expect(context.loadAdapter).not.toHaveBeenCalled();
    context.consent(true);
    await context.analytics.setConsent(true);
    expect(context.adapter.capture).not.toHaveBeenCalled();
    expect(context.analytics.canTrack()).toBe(true);
  });

  test("captures allowlisted properties with a schema version", async () => {
    const context = setup();
    context.consent(true);
    await context.analytics.setConsent(true);
    context.analytics.track("integration_added", {
      integration_type: "executor",
      token: "secret",
    } as never);
    expect(context.adapter.capture).toHaveBeenCalledWith("integration_added", {
      integration_type: "executor",
      schema_version: 2,
    });
    context.analytics.pageview("/dashboard/bots/private-id?token=secret#secret");
    expect(context.adapter.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: "/dashboard/bots/:id",
      $pathname: "/dashboard/bots/:id",
      schema_version: 2,
    });
  });

  test("rechecks consent at every call, resets on revocation, and reuses the SDK on regrant", async () => {
    const context = setup();
    context.consent(true);
    await context.analytics.setConsent(true);
    context.consent(false);
    context.analytics.track("integration_added", { integration_type: "github" });
    context.analytics.identify("another-user");
    context.analytics.pageview("/dashboard");
    expect(context.adapter.capture).not.toHaveBeenCalled();
    expect(context.adapter.identify).not.toHaveBeenCalled();
    await context.analytics.setConsent(false);
    expect(context.adapter.optOut).toHaveBeenCalledTimes(1);
    expect(context.adapter.reset).toHaveBeenCalledTimes(1);
    context.consent(true);
    await context.analytics.setConsent(true);
    expect(context.loadAdapter).toHaveBeenCalledTimes(1);
    expect(context.adapter.init).toHaveBeenCalledTimes(1);
    expect(context.adapter.optIn).toHaveBeenCalledTimes(1);
  });

  test("does not initialize if consent is revoked during the lazy import", async () => {
    const context = setup();
    let resolve!: (adapter: AnalyticsAdapter) => void;
    let consent = true;
    const analytics = createAnalytics({
      enabled: true,
      key: "key",
      host: "https://example.com",
      isBrowser: () => true,
      hasConsent: () => consent,
      loadAdapter: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const pending = analytics.setConsent(true);
    consent = false;
    await analytics.setConsent(false);
    resolve(context.adapter);
    await pending;
    expect(context.adapter.init).not.toHaveBeenCalled();
    expect(analytics.canTrack()).toBe(false);
  });

  test("SDK failures never propagate and loading can be retried", async () => {
    let attempts = 0;
    const context = setup();
    const analytics = createAnalytics({
      enabled: true,
      key: "key",
      host: "host",
      isBrowser: () => true,
      hasConsent: () => true,
      loadAdapter: async () => {
        if (++attempts === 1) throw new Error("network unavailable");
        return context.adapter;
      },
    });
    await analytics.setConsent(true);
    expect(analytics.canTrack()).toBe(false);
    await analytics.setConsent(true);
    context.adapter.capture = () => {
      throw new Error("SDK unavailable");
    };
    expect(() => analytics.track("integration_added", { integration_type: "mcp" })).not.toThrow();
  });
});
