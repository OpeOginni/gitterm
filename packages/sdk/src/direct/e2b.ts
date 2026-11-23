import { createSandboxTransport } from "@gitterm/agent-runtime/sandbox/index";
import { npmInstallCommand } from "@gitterm/schema/agent-install";
import { createTransportDirectProvider } from "./transport.js";
import type { DirectProviderAdapter, E2BDirectProviderConfig } from "./types.js";

/**
 * E2B's base template, with OpenCode installed when the workspace starts; or your own template
 * that already has it (`templateId`), at a size you built it in (`size: "large"` adds `-lg`).
 */
export function createE2BDirectProvider(config: E2BDirectProviderConfig): DirectProviderAdapter {
  if (!config.apiKey.trim()) throw new Error("E2B apiKey is required");
  const size = config.size ?? "standard";
  if (size !== "standard" && size !== "large") {
    throw new Error("E2B size must be standard or large");
  }
  const templateId = config.templateId?.trim();
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
    template: async () => templateId || undefined,
    ...(templateId && size === "large" ? { machine: { templateSuffix: "-lg" } } : {}),
    timeoutMs: config.timeoutMs ?? 10 * 60_000,
    setupCommands: templateId ? [] : [npmInstallCommand(["@opencode/cli@2"])],
  });
}
