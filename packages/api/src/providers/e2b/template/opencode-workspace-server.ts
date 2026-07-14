import { Template, waitForTimeout, defaultBuildLogger } from "e2b";
import "dotenv/config";

async function main() {
  const template = Template()
    .fromNodeImage("20-bookworm-slim")
    .aptInstall(["git", "bash", "curl", "ca-certificates"], {
      noInstallRecommends: true,
    })
    .npmInstall("@gitterm/opencode-workspace@1.17.20-workspaces.8", { g: true })
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
