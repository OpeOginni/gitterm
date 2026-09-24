import { expect, test } from "bun:test";
import { MODEL_PROVIDERS, normalizeModelProviderFields } from "./model-providers";

test("provider names are unique and OAuth providers name their flow", () => {
  const names = MODEL_PROVIDERS.map((provider) => provider.name);
  expect(new Set(names).size).toBe(names.length);
  for (const provider of MODEL_PROVIDERS) {
    expect(provider.plugin === null).toBe(provider.authType === "api_key");
  }
});

test("provider fields are trimmed, required, and validated", () => {
  const accountId = "0123456789abcdef0123456789abcdef";
  expect(
    normalizeModelProviderFields("cloudflare-ai-gateway", {
      accountId: ` ${accountId} `,
      gatewayId: "gw",
    }),
  ).toEqual({ accountId, gatewayId: "gw" });
  expect(() => normalizeModelProviderFields("cloudflare-workers-ai", {})).toThrow(
    "Account ID is required",
  );
  expect(() =>
    normalizeModelProviderFields("cloudflare-workers-ai", { accountId: "not-an-id" }),
  ).toThrow("32 hexadecimal");
  expect(() => normalizeModelProviderFields("anthropic", { accountId: accountId })).toThrow(
    "Unexpected fields",
  );
  expect(normalizeModelProviderFields("anthropic", undefined)).toBeUndefined();
});
