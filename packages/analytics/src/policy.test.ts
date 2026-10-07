import { describe, expect, test } from "bun:test";
import {
  analyticsErrorCode,
  analyticsPath,
  eventProperties,
  sanitizeAnalyticsProperties,
} from "./policy";

describe("analytics privacy policy", () => {
  test.each([
    ["/", "/"],
    ["https://site.example/login?redirect=secret#token", "/login"],
    ["/dashboard/settings/billing/", "/dashboard/settings/billing"],
    ["/dashboard/bots/new", "/dashboard/bots/new"],
    ["/dashboard/bots/new/", "/dashboard/bots/new"],
    ["/dashboard/bots/private-name", "/dashboard/bots/:id"],
    ["/admin/users/private-id", "/other"],
    ["/unknown/private-repository", "/other"],
  ])("sanitizes %s", (input, expected) => expect(analyticsPath(input)).toBe(expected));

  test("sanitizes initial and current SDK metadata, not just explicit pageviews", () => {
    expect(
      sanitizeAnalyticsProperties({
        $current_url: "https://site.example/login?token=secret",
        $pathname: "/dashboard/bots/private-id",
        $referrer: "https://github.com/private/repo?code=secret",
        $title: "Private repository",
        $browser: "Firefox",
        $set_once: {
          $initial_current_url: "https://site.example/?token=secret",
          $initial_referrer: "private",
          $initial_utm_source: "private",
        },
      }),
    ).toEqual({
      $current_url: "/login",
      $pathname: "/dashboard/bots/:id",
      $browser: "Firefox",
      $set_once: { $initial_current_url: "/" },
    });
  });

  test("never sends raw error messages or arbitrary codes", () => {
    expect(analyticsErrorCode({ data: { code: "FORBIDDEN" }, message: "secret" })).toBe(
      "FORBIDDEN",
    );
    expect(analyticsErrorCode(new Error("secret API key"))).toBe("UNKNOWN");
    expect(analyticsErrorCode({ data: { code: "secret" } })).toBe("UNKNOWN");
    expect(analyticsErrorCode(null)).toBe("UNKNOWN");
  });

  test("rejects content, non-scalar properties, and invalid durations", () => {
    expect(
      eventProperties("trial_failed", {
        duration_ms: Infinity,
        error_code: "TIMEOUT",
        prompt: "secret",
        repo: "private",
      }),
    ).toEqual({ error_code: "TIMEOUT" });
    expect(
      eventProperties("integration_added", {
        integration_type: "mcp",
        headers: { Authorization: "secret" },
      }),
    ).toEqual({ integration_type: "mcp" });
  });
});
