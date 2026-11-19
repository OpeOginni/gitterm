import { Template, waitForTimeout, type TemplateClass } from "e2b";
import { GITTERM_CLI_PACKAGE } from "./cli-package";

/**
 * T3 Code server template. Mirrors .docker/T3Code.Server.Dockerfile:
 * Node 22 for npm/provider launchers and the agent CLIs T3 drives.
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
      .npmInstall(
        [
          `t3@${t3Version}`,
          "@anthropic-ai/claude-code@latest",
          "@openai/codex@latest",
          `@opencode/cli@${opencodeVersion}`,
          GITTERM_CLI_PACKAGE,
        ],
        { g: true },
      )
      // The npm launcher downloads the native runtime on first use. Populate the sandbox user's cache at build time.
      .runCmd("t3 --version", { user: "user" })
      .setStartCmd("sleep infinity", waitForTimeout(1_000))
  );
}
