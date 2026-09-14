import { describe, expect, test } from "bun:test";
import { PROVIDER_DEFINITIONS, PROVIDER_KEYS } from "@gitterm/schema";
import { getAvailableProviderNames, getProvider } from ".";
import { PROVIDER_SECURITY_CAPABILITIES } from "./security-capabilities";

const REQUIRED_METHODS = [
  "createWorkspace",
  "createPersistentWorkspace",
  "pauseWorkspace",
  "resumeWorkspace",
  "terminateWorkspace",
  "getStatus",
  "createOrGetExposedPortDomain",
  "removeExposedPortDomain",
  "getWorkspaceSSHAccess",
  "revokeWorkspaceSSHAccess",
] as const;

describe("compute provider conformance", () => {
  test("registries contain the same provider keys", () => {
    const expected = PROVIDER_KEYS.toSorted();

    expect(getAvailableProviderNames().toSorted()).toEqual(expected);
    expect(Object.keys(PROVIDER_DEFINITIONS).toSorted()).toEqual(expected);
    expect(Object.keys(PROVIDER_SECURITY_CAPABILITIES).toSorted()).toEqual(expected);
  });

  for (const providerKey of PROVIDER_KEYS) {
    test(`${providerKey} exposes the compute provider contract`, () => {
      const provider = getProvider(providerKey);

      expect(provider.name).toBe(providerKey);
      for (const method of REQUIRED_METHODS) {
        expect(typeof provider[method]).toBe("function");
      }
      expect(PROVIDER_SECURITY_CAPABILITIES[providerKey].runtimeOnlySecretFiles).toBe(true);
    });
  }
});
