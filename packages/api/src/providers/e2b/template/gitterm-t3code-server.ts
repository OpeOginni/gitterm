import { Template, waitForTimeout, type TemplateClass } from "e2b";
import { GITTERM_CLI_CACHE_BUST } from "./cli-package";

/**
 * T3 Code server template. Mirrors .docker/T3Code.Server.Dockerfile:
 * node 22 for npm/provider launchers and the agent CLIs T3 drives. Published T3
 * ships its self-contained executable in a platform package.
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
      // Build tools preserve compatibility with older, explicitly pinned t3 releases.
      .runCmd(GITTERM_CLI_CACHE_BUST)
      .npmInstall(
        [
          `t3@${t3Version}`,
          "@anthropic-ai/claude-code@latest",
          "@openai/codex@latest",
          `@opencode/cli@${opencodeVersion}`,
          "@gitterm/cli@latest",
        ],
        { g: true },
      )
      .setStartCmd("sleep infinity", waitForTimeout(1_000))
  );
}
