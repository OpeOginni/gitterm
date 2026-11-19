import { Template, waitForTimeout, defaultBuildLogger } from "e2b";
import "dotenv/config";
import { GITTERM_CLI_PACKAGE } from "./cli-package";

async function main() {
  const template = Template()
    .fromNodeImage("22-bookworm-slim")
    .aptInstall(["git", "bash", "curl", "ca-certificates"], {
      noInstallRecommends: true,
    })
    .npmInstall(["@gitterm/opencode-workspace@1.18.0-workspaces.1", GITTERM_CLI_PACKAGE], {
      g: true,
    })
    .runCmd('ln -sf "$(command -v opencode-workspace)" /usr/local/bin/opencode', { user: "root" })
    .setEnvs({ OPENCODE_EXPERIMENTAL_WORKSPACES: "true" })
    .setStartCmd("sleep infinity", waitForTimeout(1_000));

  const result = await Template.build(template, "opencode-workspace-server", {
    cpuCount: 2,
    memoryMB: 2048,
    onBuildLogs: defaultBuildLogger(),
    apiKey: process.env.E2B_API_KEY,
  });

  console.log(result);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.log(err);
    process.exit(1);
  });
