import { Template, defaultBuildLogger } from "e2b";
import { opencodeServerTemplate } from "./gitterm-opencode-server";
import { opencodeServerWithSSHTemplate } from "./gitterm-opencode-server-with-ssh";
import 'dotenv/config';


async function main() {

const opencodeServerE2B = await Template.build(opencodeServerTemplate, "gitterm-opencode-server", {
  cpuCount: 2,
  memoryMB: 2048,
  onBuildLogs: defaultBuildLogger(),
  apiKey: ""
});

const opencodeServerWithSSH_E2B = await Template.build(opencodeServerWithSSHTemplate, "gitterm-opencode-server-with-ssh", {
  cpuCount: 2,
  memoryMB: 4096,
  onBuildLogs: defaultBuildLogger(),
  apiKey: ""
});


console.log(opencodeServerE2B)
console.log(opencodeServerWithSSH_E2B)
}

main().then(() => {
    process.exit(0)
})
.catch((err) => {
    console.log(err)
    process.exit(1)
})