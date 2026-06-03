import { Template, waitForTimeout, type TemplateClass } from "e2b";

export const opencodeServerTemplate: TemplateClass = Template()
  .fromTemplate("opencode")
  .aptInstall(["nodejs", "npm"])
  .runCmd("npm install -g opencode-ai@latest")
  .setStartCmd("sleep infinity", waitForTimeout(1_000));
