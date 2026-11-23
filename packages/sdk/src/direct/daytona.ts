import { createSandboxTransport } from "@gitterm/agent-runtime/sandbox/index";
import { pinFloatingDockerImage, resolveDirectImage } from "./provisioning.js";
import { createTransportDirectProvider } from "./transport.js";
import type { DaytonaDirectProviderConfig, DirectProviderAdapter } from "./types.js";

/** Daytona runs the Gitterm runtime image, which holds the agent. */
export function createDaytonaDirectProvider(
  config: DaytonaDirectProviderConfig,
): DirectProviderAdapter {
  if (!config.apiKey.trim()) throw new Error("Daytona apiKey is required");
  const resources = {
    ...(config.cpu != null ? { cpu: config.cpu } : {}),
    ...(config.memory != null ? { memory: config.memory } : {}),
    ...(config.disk != null ? { disk: config.disk } : {}),
  };
  return createTransportDirectProvider({
    name: "daytona",
    capabilities: {
      persistence: "supported",
      recommendedLifecycle: "persistent",
      supportsPause: true,
      ephemeralPause: "stateful",
      supportsKeepAlive: true,
    },
    transport: createSandboxTransport({
      provider: "daytona",
      apiKey: config.apiKey,
      target: config.target,
    }),
    template: () => pinFloatingDockerImage(resolveDirectImage(config.image)),
    ...(Object.keys(resources).length ? { machine: { resources } } : {}),
    // Daytona's own default auto-stop interval.
    timeoutMs: 15 * 60_000,
  });
}
