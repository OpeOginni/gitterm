import { Template, waitForPort, type TemplateClass } from "e2b";
import { GITTERM_CLI_CACHE_BUST } from "./cli-package";

export function createOpencodeServerWithSSHTemplate(opencodeVersion: string): TemplateClass {
  return Template()
    .fromNodeImage("20-bookworm-slim")
    .aptInstall(["git", "bash", "curl", "ca-certificates", "openssh-server"], {
      noInstallRecommends: true,
    })
    .runCmd(
      "curl -fsSL -o /usr/local/bin/websocat https://github.com/vi/websocat/releases/latest/download/websocat.x86_64-unknown-linux-musl && chmod a+x /usr/local/bin/websocat",
      { user: "root" },
    )
    .runCmd("mkdir -p /run/sshd && ssh-keygen -A", { user: "root" })
    .runCmd(GITTERM_CLI_CACHE_BUST)
    .npmInstall([`opencode-ai@${opencodeVersion}`, "@gitterm/cli@latest"], { g: true })
    .setStartCmd(
      "sudo /usr/sbin/sshd && /usr/local/bin/websocat -b --exit-on-eof ws-l:0.0.0.0:8081 tcp:127.0.0.1:22",
      waitForPort(8081),
    );
}
