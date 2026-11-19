import { Template, waitForTimeout, type TemplateClass } from "e2b";
import { OPENCODE_PACKAGE } from "../../opencode-version";
import { GITTERM_CLI_PACKAGE } from "./cli-package";

export function createOpencodeServerTemplate(opencodeVersion: string): TemplateClass {
  return Template()
    .fromNodeImage("22-bookworm-slim")
    .aptInstall(["git", "bash", "curl", "ca-certificates"], {
      noInstallRecommends: true,
    })
    .npmInstall([`${OPENCODE_PACKAGE}@${opencodeVersion}`, GITTERM_CLI_PACKAGE], { g: true })
    .setStartCmd("sleep infinity", waitForTimeout(1_000));
}
