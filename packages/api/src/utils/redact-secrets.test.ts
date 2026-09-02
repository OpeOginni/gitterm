import { describe, expect, test } from "bun:test";
import { redactSecrets } from "./redact-secrets";

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
