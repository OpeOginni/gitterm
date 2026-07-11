import { Template, defaultBuildLogger } from "e2b";
import { createOpencodeServerTemplate } from "./gitterm-opencode-server";
import { createOpencodeServerWithSSHTemplate } from "./gitterm-opencode-server-with-ssh";
import { createT3CodeServerTemplate } from "./gitterm-t3code-server";
import { getLatestOpencodeVersion } from "../../opencode-version";
import { getLatestT3Version } from "../../t3-version";
import "dotenv/config";

async function main() {
  const [opencodeVersion, t3Version] = await Promise.all([
    getLatestOpencodeVersion(),
    getLatestT3Version(),
  ]);
  console.log(`[e2b-template] pinning opencode version ${opencodeVersion}`);
  console.log(`[e2b-template] pinning t3 version ${t3Version}`);

  const opencodeServerE2B = await Template.build(
    createOpencodeServerTemplate(opencodeVersion),
    "gitterm-opencode-server",
    {
      cpuCount: 2,
      memoryMB: 2048,
      onBuildLogs: defaultBuildLogger(),
      apiKey: process.env.E2B_API_KEY,
    },
  );

  const opencodeServerWithSSH_E2B = await Template.build(
    createOpencodeServerWithSSHTemplate(opencodeVersion),
    "gitterm-opencode-server-with-ssh",
    {
      cpuCount: 4,
      memoryMB: 4096,
      onBuildLogs: defaultBuildLogger(),
      apiKey: process.env.E2B_API_KEY,
    },
  );

  const t3CodeServerE2B = await Template.build(
    createT3CodeServerTemplate(t3Version, opencodeVersion),
    "gitterm-t3code-server",
    {
      cpuCount: 2,
      memoryMB: 2048,
      onBuildLogs: defaultBuildLogger(),
      apiKey: process.env.E2B_API_KEY,
    },
  );

  console.log(opencodeServerE2B);
  console.log(opencodeServerWithSSH_E2B);
  console.log(t3CodeServerE2B);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.log(err);
    process.exit(1);
  });
