import { describe, expect, test } from "bun:test";
import { redactRemoteErrorText, redactSecrets } from "./redact-secrets";

describe("redactSecrets", () => {
  test("removes credentials from errors and nested observability payloads", () => {
    const token = "github-secret-token";
    const error = new Error(`request failed with ${token}`);
    const result = redactSecrets({ error, request: { authorization: token } }, [token]) as {
      error: Error;
      request: { authorization: string };
    };

    expect(result.error.message).toBe("request failed with [REDACTED]");
    expect(result.error.stack).not.toContain(token);
    expect(result.request.authorization).toBe("[REDACTED]");
  });
});

test("remote error diagnostics retain the failure but redact headers, known credentials, and URLs", () => {
  const result = redactRemoteErrorText(
    'HTTP 400: session expired; custom-header-value\n"Authorization": "Bearer saved-token"\n' +
      "Basic encoded-password\nCookie: session=cookie-value\n" +
      "https://example.com/mcp?key=url-secret\nAPI_KEY=unknown-key",
    ["custom-header-value"],
  );
  expect(result).toContain("HTTP 400: session expired");
  for (const secret of [
    "custom-header-value",
    "saved-token",
    "encoded-password",
    "cookie-value",
    "url-secret",
    "unknown-key",
  ]) {
    expect(result).not.toContain(secret);
  }
  expect(result).toContain("[REDACTED]");
  expect(redactRemoteErrorText("x".repeat(2000))).toHaveLength(1000);
});
