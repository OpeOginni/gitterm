import { createSandboxTransport } from "@gitterm/agent-runtime/sandbox/index";
import { createTransportDirectProvider } from "./transport.js";
import type { BoatDirectProviderConfig, DirectProviderAdapter } from "./types.js";

/** Boat's base image has no current agent, so it is installed. */
export function createBoatDirectProvider(config: BoatDirectProviderConfig): DirectProviderAdapter {
  if (!config.apiKey.trim()) throw new Error("Boat apiKey is required");
  return createTransportDirectProvider({
    name: "boat",
    capabilities: {
      persistence: "supported",
      recommendedLifecycle: "ephemeral",
      supportsPause: true,
      ephemeralPause: "stateful",
      supportsKeepAlive: true,
    },
    transport: createSandboxTransport({ provider: "boat", apiKey: config.apiKey }),
    ...(config.size ? { machine: { size: config.size } } : {}),
    // `null` asked for no time limit; Boat allows at most a day.
    timeoutMs: config.timeoutMs === null ? 24 * 60 * 60_000 : (config.timeoutMs ?? 10 * 60_000),
    setupCommands: config.runtimeSetupCommands ?? [
      "npm install -g @opencode/cli@2 --no-audit --fund=false",
    ],
  });
}
