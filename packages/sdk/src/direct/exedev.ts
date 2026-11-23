import { createSandboxTransport } from "@gitterm/agent-runtime/sandbox/index";
import { resolveDirectImage } from "./provisioning.js";
import { createTransportDirectProvider } from "./transport.js";
import type { DirectProviderAdapter, ExeDevDirectProviderConfig } from "./types.js";

/**
 * exe.dev VMs from the Gitterm runtime image. A workspace can also use a VM you already
 * have (`exedev.existingVmName`); terminating it then stops the agent and keeps the VM.
 */
export function createExeDevDirectProvider(
  config: ExeDevDirectProviderConfig,
): DirectProviderAdapter {
  if (!config.apiToken.trim()) throw new Error("exe.dev apiToken is required");
  return createTransportDirectProvider({
    name: "exedev",
    capabilities: {
      persistence: "supported",
      recommendedLifecycle: "ephemeral",
      supportsPause: true,
      ephemeralPause: "stateful",
      supportsKeepAlive: false,
    },
    transport: createSandboxTransport({ provider: "exedev", apiKey: config.apiToken }),
    template: async () => resolveDirectImage(config.image),
    machine: {
      ...(config.cpu ? { cpu: config.cpu } : {}),
      ...(config.memory ? { memory: config.memory } : {}),
      ...(config.disk ? { disk: config.disk } : {}),
    },
    // exe.dev never deletes a VM on its own; this only satisfies the lifetime check.
    timeoutMs: 24 * 60 * 60_000,
    setupCommands: config.runtimeSetupCommands,
    existing(input) {
      if (!input.exedev) return undefined;
      const name = input.exedev.existingVmName.trim();
      if (!name) throw new Error("exe.dev existingVmName is required");
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("Invalid exe.dev existingVmName");
      return name;
    },
  });
}
