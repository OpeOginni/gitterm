/**
 * The Pi coding agent (`@earendil-works/pi-coding-agent`, command `pi`). Pi is a terminal
 * agent with no server, so a workspace serves it in a browser terminal (ttyd), inside a tmux
 * session that keeps Pi running when the browser closes and that `gitterm move` starts.
 *
 * Shared by the Gitterm server, which provisions Pi workspaces, and the CLI, which moves Pi
 * sessions and installs the extension below on the user's machine.
 */

import { ENSURE_NODE_COMMAND } from "./agent-install.js";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent@1.6.0";
const TTYD_VERSION = "1.7.7";
/** The tmux session the workspace's terminal attaches to. */
export const PI_TMUX_SESSION = "pi";
/** Pi's global extension folder, below `~/.pi/agent` (or `$PI_CODING_AGENT_DIR`). */
export const PI_EXTENSION_PATH = "extensions/gitterm.ts";

/**
 * Installs Pi (with Node 22.19 or newer, when the image lacks it), ttyd and, where the package
 * manager allows it, tmux. Everything goes to `~/.local`, so it works without root; tmux needs
 * root or sudo.
 */
export const PI_INSTALL_COMMAND = [
  "set -e",
  ENSURE_NODE_COMMAND,
  `npm install -g --prefix "$HOME/.local" --ignore-scripts --no-audit --fund=false ${PI_PACKAGE}`,
  `[ -x "$HOME/.local/bin/ttyd" ] || { curl -fsSL -o "$HOME/.local/bin/ttyd" "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.$(uname -m)" && chmod +x "$HOME/.local/bin/ttyd"; }`,
  'SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo -n"',
  "command -v tmux >/dev/null || { command -v apt-get >/dev/null && $SUDO apt-get update -qq && $SUDO apt-get install -y -qq tmux; } || { command -v dnf >/dev/null && $SUDO dnf install -y -q tmux; } || echo 'tmux is not installed: Pi stops when the browser terminal closes.'",
].join("\n");

/**
 * Serves Pi in a browser terminal on `port`, behind HTTP basic auth (`opencode` and the
 * workspace password from `$PI_WEB_PASSWORD`, as GitTerm's clients send for OpenCode).
 * Each browser attaches to the same tmux session; without tmux, each gets its own Pi.
 */
export function piServeCommand(port: number): string {
  return [
    'export PATH="$HOME/.local/bin:$PATH"',
    `exec ttyd --writable --port ${port} --credential "opencode:$PI_WEB_PASSWORD" bash -lc 'command -v tmux >/dev/null && exec tmux new-session -A -s ${PI_TMUX_SESSION} pi --continue || exec pi --continue'`,
  ].join("; ");
}

/**
 * Pi's GitTerm extension: `/cloud` and `/cloud-return`, and delivery of the notices
 * `gitterm move` and `gitterm return` leave for a session (in
 * `~/.pi/agent/gitterm/inbox/<session id>.txt`) when that session opens. While Pi works in a
 * session, `~/.pi/agent/gitterm/busy/<session id>` holds Pi's process id, so GitTerm doesn't
 * copy the session mid-turn.
 */
export const PI_EXTENSION = String.raw`import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
const inbox = (id) => path.join(agentDir, "gitterm", "inbox", id + ".txt");
const busy = (ctx) => path.join(agentDir, "gitterm", "busy", ctx.sessionManager.getSessionId());

export default function (pi) {
  /** A notice GitTerm left for this session: the agent reads it as the next message. */
  const deliver = (id, send) => {
    const file = id && inbox(id);
    if (!file || !existsSync(file)) return;
    const text = readFileSync(file, "utf8");
    rmSync(file, { force: true });
    if (text.trim()) send(text);
  };
  const show = (text) => pi.sendMessage({ customType: "gitterm", content: text, display: true });
  const gitterm = (args) => pi.exec("gitterm", args, { timeout: 15 * 60_000 });

  // A session Pi opens at startup (the cloud's tmux, a terminal). After /cloud-return,
  // the replacement session delivers its own notice below.
  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "startup") return;
    deliver(ctx.sessionManager.getSessionId(), (text) => pi.sendUserMessage(text));
  });

  pi.on("agent_start", async (_event, ctx) => {
    mkdirSync(path.dirname(busy(ctx)), { recursive: true });
    writeFileSync(busy(ctx), String(process.pid));
  });
  // Settled: Pi won't continue by itself (no retry, compaction or queued message is left).
  pi.on("agent_settled", async (_event, ctx) => rmSync(busy(ctx), { force: true }));

  pi.registerCommand("cloud", {
    description: "Move this session and its checkout to a GitTerm cloud workspace",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      show("Moving this session to a GitTerm cloud workspace…");
      const id = ctx.sessionManager.getSessionId();
      const result = await gitterm(["move", "--agent", "pi", "--session", id, ...(args?.trim() ? [args.trim()] : [])]);
      show((result.stdout + result.stderr).trim() || (result.code === 0 ? "Moved." : "The move failed."));
    },
  });

  pi.registerCommand("cloud-return", {
    description: "Bring this session back from its GitTerm cloud workspace",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      show("Bringing this session back from the cloud…");
      const id = ctx.sessionManager.getSessionId();
      const file = ctx.sessionManager.getSessionFile();
      const result = await gitterm(["return", "--session", id, ...(args?.trim() ? ["--message", args.trim()] : [])]);
      if (result.code !== 0 || !file) return show((result.stdout + result.stderr).trim() || "The return failed.");
      // The session file now holds the cloud's conversation: open it again from disk.
      await ctx.switchSession(file, {
        withSession: async (next) => deliver(id, (text) => next.sendUserMessage(text)),
      });
    },
  });
}
`;
