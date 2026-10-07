import { describe, expect, test } from "bun:test";
import { isUnexpectedError, sanitizeExceptionProperties } from "./errors";

describe("exception privacy", () => {
  test("rebuilds nested causes and frames without any user content", () => {
    const properties = sanitizeExceptionProperties({
      $exception_list: [
        {
          type: "TypeError",
          value: "secret key sk-123 and prompt",
          module: "private-repo",
          mechanism: { handled: false, source: "private-repo", data: { secret: "private" } },
          stacktrace: {
            type: "raw",
            frames: [
              {
                platform: "web:javascript",
                filename: "https://gitterm.dev/_next/static/chunks/abc.js?token=secret",
                lineno: 5,
                colno: 7,
                function: "secret",
                vars: { prompt: "secret" },
                context_line: "secret",
                abs_path: "/private-repo",
                pre_context: ["secret"],
              },
              { filename: "/Users/private/repo/source.ts", lineno: 1 },
              { filename: "https://private-workspace.dev/private-repo.js", lineno: 5 },
              { filename: "https://gitterm.dev/_next/static/../../secret.js", lineno: 5 },
            ],
          },
        },
        { type: "SecretCustomError", value: "secret cause" },
      ],
      $exception_message: "secret",
      $exception_fingerprint: "secret",
      $exception_steps: ["secret"],
      $current_url: "https://gitterm.dev/?secret",
      authorization: "secret",
      $set: { email: "secret" },
      distinct_id: "user-internal-id",
      $lib: "web",
      service: "web",
    });
    expect(properties?.$exception_list).toEqual([
      {
        type: "TypeError",
        value: "TypeError: details redacted",
        mechanism: { handled: false, synthetic: false, type: "onerror" },
        stacktrace: {
          type: "raw",
          frames: [
            {
              platform: "web:javascript",
              filename: "/_next/static/chunks/abc.js",
              lineno: 5,
              colno: 7,
            },
          ],
        },
      },
      {
        type: "Error",
        value: "Error: details redacted",
        mechanism: { handled: false, synthetic: false, type: "onerror" },
      },
    ]);
    expect(JSON.stringify(properties)).not.toContain("secret");
    expect(properties?.distinct_id).toBe("user-internal-id");
  });

  test("keeps chunk IDs for private source-map resolution and strips server paths", () => {
    const id = "0197e6db-9a73-7b91-9e80-4e1b7158db5c";
    const result = sanitizeExceptionProperties({
      service: "server",
      $exception_list: [
        {
          type: "Error",
          stacktrace: {
            frames: [
              {
                platform: "node:javascript",
                filename: "/app/private/repo/index.mjs",
                lineno: 2,
                chunk_id: id,
              },
            ],
          },
        },
      ],
    });
    expect(JSON.stringify(result)).toContain(id);
    expect(JSON.stringify(result)).toContain("index.mjs");
    expect(JSON.stringify(result)).not.toContain("/app/private/repo");
  });

  test("fails closed for malformed exception payloads", () => {
    expect(sanitizeExceptionProperties({ message: "secret" })).toBeNull();
    expect(sanitizeExceptionProperties({ $exception_list: [] })).toBeNull();
    expect(
      JSON.stringify(sanitizeExceptionProperties({ $exception_list: [null, "secret"] })),
    ).not.toContain("secret");
  });

  test("expected errors are not incidents", () => {
    expect(isUnexpectedError({ name: "AbortError" })).toBe(false);
    expect(isUnexpectedError({ data: { code: "FORBIDDEN" } })).toBe(false);
    expect(isUnexpectedError({ code: "BAD_REQUEST" })).toBe(false);
    expect(isUnexpectedError({ code: "INTERNAL_SERVER_ERROR" })).toBe(true);
    expect(isUnexpectedError(new TypeError("private"))).toBe(true);
  });
});
