import { Template, waitForPort, type TemplateClass } from "e2b";

export const opencodeServerWithSSHTemplate: TemplateClass = Template()
  .fromTemplate("opencode")
  .aptInstall(["openssh-server"])
  .runCmd(
    "curl -fsSL -o /usr/local/bin/websocat https://github.com/vi/websocat/releases/latest/download/websocat.x86_64-unknown-linux-musl && chmod a+x /usr/local/bin/websocat",
    { user: "root" },
  )
  .setStartCmd(
    "/usr/local/bin/websocat -b --exit-on-eof ws-l:0.0.0.0:8081 tcp:127.0.0.1:22",
    waitForPort(8081),
  );
