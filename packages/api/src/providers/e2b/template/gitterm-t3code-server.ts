import { Template, waitForTimeout, type TemplateClass } from "e2b";

/**
 * T3 Code server template. Mirrors .docker/T3Code.Server.Dockerfile:
 * node 22 (t3 engines), build tools for node-pty, and the agent CLIs T3 drives.
 * The agent itself is started at provision time (see e2b/index.ts startAgentServer).
 */
export function createT3CodeServerTemplate(
  t3Version: string,
  opencodeVersion: string,
): TemplateClass {
  return (
    Template()
      .fromNodeImage("22-bookworm-slim")
      .aptInstall(["git", "bash", "curl", "unzip", "ca-certificates", "python3", "make", "g++"], {
        noInstallRecommends: true,
      })
      // node-pty (bundled by t3) has no linux-x64 prebuilds; needs python/make/g++.
      .npmInstall(
        [
          `t3@${t3Version}`,
          "@anthropic-ai/claude-code@latest",
          "@openai/codex@latest",
          `opencode-ai@${opencodeVersion}`,
        ],
        { g: true },
      )
      .setStartCmd("sleep infinity", waitForTimeout(1_000))
  );
}
