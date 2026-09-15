import { Template, waitForTimeout, type TemplateClass } from "e2b";
import { GITTERM_CLI_CACHE_BUST } from "./cli-package";

export function createOpencodeServerTemplate(opencodeVersion: string): TemplateClass {
  return Template()
    .fromNodeImage("20-bookworm-slim")
    .aptInstall(["git", "bash", "curl", "ca-certificates"], {
      noInstallRecommends: true,
    })
    .runCmd(GITTERM_CLI_CACHE_BUST)
    .npmInstall([`opencode-ai@${opencodeVersion}`, "@gitterm/cli@latest"], { g: true })
    .setStartCmd("sleep infinity", waitForTimeout(1_000));
}
