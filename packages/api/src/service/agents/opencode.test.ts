import { expect, test } from "bun:test";
import { buildOpencodeAuthJson } from "./opencode";

test("generated credentials satisfy the V2 SQLite seed contract", () => {
  const auth = JSON.parse(
    buildOpencodeAuthJson([
      {
        credentialId: "credential",
        providerName: "openai-oauth",
        logicalProviderKey: "openai",
        credential: { type: "oauth", refresh: "refresh-token" },
      },
      {
        credentialId: "api-key",
        providerName: "anthropic",
        logicalProviderKey: "anthropic",
        credential: { type: "api_key", apiKey: "api-key-value" },
      },
    ]),
  );

  expect(auth).toEqual({
    openai: {
      type: "oauth",
      refresh: "refresh-token",
      access: "",
      expires: 0,
    },
    anthropic: { type: "api", key: "api-key-value" },
  });
});
