import { expect, test } from "bun:test";
import { apiPath } from "./url";

test("adds /api exactly once whether or not the base includes it", () => {
  expect(apiPath("https://app.example.com/api", "github/callback")).toBe(
    "https://app.example.com/api/github/callback",
  );
  expect(apiPath("https://app.example.com/api/", "/github/callback")).toBe(
    "https://app.example.com/api/github/callback",
  );
  expect(apiPath("https://api.example.com", "github/callback")).toBe(
    "https://api.example.com/api/github/callback",
  );
  expect(apiPath("https://api.example.com/api", "workload-identity")).toBe(
    "https://api.example.com/api/workload-identity",
  );
});
