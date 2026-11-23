import { createSandboxTransport } from "@gitterm/agent-runtime/sandbox/index";
import { createTransportDirectProvider } from "./transport.js";
import type { DirectProviderAdapter, VercelDirectProviderConfig } from "./types.js";

/** Vercel's runtimes have no agent, so it is installed unless an image is given. */
export function createVercelDirectProvider(
  config: VercelDirectProviderConfig,
): DirectProviderAdapter {
  if (!config.apiToken.trim()) throw new Error("Vercel apiToken is required");
  return createTransportDirectProvider({
    name: "vercel",
    capabilities: {
      persistence: "supported",
      recommendedLifecycle: "persistent",
      supportsPause: true,
      ephemeralPause: "stateful",
      supportsKeepAlive: true,
    },
    transport: createSandboxTransport({
      provider: "vercel",
      apiKey: config.apiToken,
      teamId: config.teamId,
      projectId: config.projectId,
    }),
    template: async () => config.image,
    machine: {
      ...(config.runtime ? { runtime: config.runtime } : {}),
      ...(config.vcpus != null ? { vcpus: config.vcpus } : {}),
    },
    timeoutMs: config.timeoutMs ?? 10 * 60_000,
    setupCommands:
      config.runtimeSetupCommands ??
      (config.image ? [] : ["npm install -g @opencode/cli@2 --no-audit --fund=false"]),
  });
}
