import page from "@gitterm/terminal/index.html" with { type: "text" };
import session from "@gitterm/terminal/session.sh" with { type: "text" };
import tmuxConf from "@gitterm/terminal/tmux.conf" with { type: "text" };
import { TERMINAL_DIR } from "@gitterm/schema/terminal";
import type { AgentFile } from "../providers/compute";

export { terminalServeCommand, TERMINAL_PASSWORD_ENV } from "@gitterm/schema/terminal";

/** The browser terminal's page and scripts, for an agent that runs in it. */
export function terminalFiles(): AgentFile[] {
  // A text import of HTML is a string, though Bun's types call it a bundle.
  const files = {
    "index.html": page as unknown as string,
    "session.sh": session,
    "tmux.conf": tmuxConf,
  };
  return Object.entries(files).map(([name, content]) => ({
    path: `${TERMINAL_DIR}/${name}`,
    contentBase64: Buffer.from(content).toString("base64"),
  }));
}
