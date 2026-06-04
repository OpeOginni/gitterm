import { Template, waitForTimeout, type TemplateClass } from "e2b";

export const opencodeServerTemplate: TemplateClass = Template()
  .fromNodeImage("20-bookworm-slim")
  .aptInstall(["git", "bash", "curl", "ca-certificates"], {
    noInstallRecommends: true,
  })
  .npmInstall("opencode-ai@latest", { g: true })
  .setStartCmd("sleep infinity", waitForTimeout(1_000));
