import { Template, waitForTimeout, type TemplateClass } from "e2b";
import { GITTERM_CLI_CACHE_BUST } from "./cli-package";

export function createOpencodeServerTemplate(opencodeVersion: string): TemplateClass {
  return Template()
    .fromNodeImage("20-bookworm-slim")
    .aptInstall(["git", "bash", "curl", "ca-certificates", "python3"], {
      noInstallRecommends: true,
    })
    .runCmd(GITTERM_CLI_CACHE_BUST)
    .npmInstall([`@opencode/cli@${opencodeVersion}`, "@gitterm/cli@latest"], { g: true })
    .setStartCmd("sleep infinity", waitForTimeout(1_000));
}
