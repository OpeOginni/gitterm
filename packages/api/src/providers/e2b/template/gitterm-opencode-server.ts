import { Template, waitForTimeout, type TemplateClass } from "e2b";

export function createOpencodeServerTemplate(opencodeVersion: string): TemplateClass {
  return Template()
    .fromNodeImage("20-bookworm-slim")
    .aptInstall(["git", "bash", "curl", "ca-certificates"], {
      noInstallRecommends: true,
    })
    .npmInstall(`opencode-ai@${opencodeVersion}`, { g: true })
    .setStartCmd("sleep infinity", waitForTimeout(1_000));
}
