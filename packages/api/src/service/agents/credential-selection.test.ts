import { expect, test } from "bun:test";
import { selectWorkspaceCredentials } from "./credential-selection";

const providers = [
  { name: "openai", logicalProviderKey: "openai", authType: "api_key" },
  { name: "openai-oauth", logicalProviderKey: "openai", authType: "oauth" },
  { name: "anthropic", logicalProviderKey: "anthropic", authType: "api_key" },
];
const saved = [
  { id: "oauth", logicalProviderKey: "openai", label: "subscription", isDefault: true },
  { id: "api", logicalProviderKey: "openai", label: "work", isDefault: false },
  { id: "other", logicalProviderKey: "anthropic", label: "personal", isDefault: true },
];
test("omitted models inherits defaults, explicit models inherits nothing", () => {
  expect(selectWorkspaceCredentials(undefined, providers, saved)).toHaveLength(2);
  expect(selectWorkspaceCredentials({}, providers, saved)).toEqual([]);
  expect(selectWorkspaceCredentials({ inherit: "none" }, providers, saved)).toEqual([]);
});
test("labels select subscriptions using the logical model provider", () => {
  expect(
    selectWorkspaceCredentials(
      { providers: { openai: { source: "saved", label: "subscription" } } },
      providers,
      saved,
    ),
  ).toEqual([{ source: "saved", credential: saved[0]! }]);
});
test("inline overrides only its provider when defaults are explicitly inherited", () => {
  const result = selectWorkspaceCredentials(
    { inherit: "defaults", providers: { openai: { source: "apiKey", apiKey: "key" } } },
    providers,
    saved,
  );
  expect(result).toEqual([
    { source: "apiKey", provider: providers[0]!, apiKey: "key" },
    { source: "saved", credential: saved[2]! },
  ]);
});
test("missing, ambiguous labels and unknown providers fail instead of falling back", () => {
  expect(() =>
    selectWorkspaceCredentials(
      { providers: { openai: { source: "saved", label: "missing" } } },
      providers,
      saved,
    ),
  ).toThrow("MODEL_CREDENTIAL_UNAVAILABLE");
  expect(() =>
    selectWorkspaceCredentials(
      { providers: { openai: { source: "saved", label: "work" } } },
      providers,
      [...saved, { ...saved[0]!, label: "work" }],
    ),
  ).toThrow("ambiguous");
  expect(() =>
    selectWorkspaceCredentials({ providers: { invalid: { source: "default" } } }, providers, saved),
  ).toThrow("MODEL_CREDENTIAL_INVALID");
});
