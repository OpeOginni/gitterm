import { Plugin } from "@opencode/plugin";
import type { SandboxSettings } from "@gitterm/sdk/sandbox";
import { registerSandboxTools } from "./sandbox";

/** Remote sandboxes for builds, tests, and previews while the session stays local. */
export const GittermSandboxToolsPlugin = Plugin.define({
  id: "gitterm.sandbox",
  async setup(ctx) {
    const options = ctx.options as Partial<SandboxSettings> | undefined;
    return registerSandboxTools(ctx, options?.accounts ? (options as SandboxSettings) : undefined);
  },
});

export default GittermSandboxToolsPlugin;
