import { Template, waitForTimeout, type TemplateClass } from "e2b";

export const opencodeServerTemplate: TemplateClass = Template()
  .fromTemplate("opencode")
  .runCmd("opencode upgrade")
  .setStartCmd("sleep infinity", waitForTimeout(1_000));
