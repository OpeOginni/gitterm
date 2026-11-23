import { createSandboxTransport } from "@gitterm/agent-runtime/sandbox/index";
import { DIRECT_E2B_TEMPLATES } from "./provisioning.js";
import { createTransportDirectProvider } from "./transport.js";
import type { DirectProviderAdapter, E2BDirectProviderConfig } from "./types.js";

/** E2B templates already hold the agent. */
export function createE2BDirectProvider(config: E2BDirectProviderConfig): DirectProviderAdapter {
  if (!config.apiKey.trim()) throw new Error("E2B apiKey is required");
  const size = config.size ?? "standard";
  if (size !== "standard" && size !== "large") {
    throw new Error("E2B size must be standard or large");
  }
  const template = config.templateId?.trim() || DIRECT_E2B_TEMPLATES[size];
  return createTransportDirectProvider({
    name: "e2b",
    capabilities: {
      persistence: "supported",
      recommendedLifecycle: "ephemeral",
      supportsPause: true,
      ephemeralPause: "stateful",
      supportsKeepAlive: true,
    },
    transport: createSandboxTransport({ provider: "e2b", apiKey: config.apiKey }),
    template: async () => template,
    timeoutMs: config.timeoutMs ?? 10 * 60_000,
  });
}
