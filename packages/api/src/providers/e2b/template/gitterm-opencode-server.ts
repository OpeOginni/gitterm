import { Template, waitForTimeout, type TemplateClass } from "e2b";
import { OPENCODE_PACKAGE } from "../../opencode-version";
import { GITTERM_CLI_CACHE_BUST } from "./cli-package";

export function createOpencodeServerTemplate(opencodeVersion: string): TemplateClass {
  return Template()
    .fromNodeImage("20-bookworm-slim")
    .aptInstall(["git", "bash", "curl", "ca-certificates"], {
      noInstallRecommends: true,
    })
    .runCmd(GITTERM_CLI_CACHE_BUST)
    .npmInstall([`${OPENCODE_PACKAGE}@${opencodeVersion}`, "@gitterm/cli@latest"], { g: true })
    .setStartCmd("sleep infinity", waitForTimeout(1_000));
}
