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
 * Pi's GitTerm extension: `/cloud` and `/cloud-return`, a footer status while a session is in
 * the cloud, a question before a message is sent here instead, and delivery of the notices
 * `gitterm move` and `gitterm return` leave for a session (in
 * `~/.pi/agent/gitterm/inbox/<session id>.txt`) when that session opens. The work itself is
 * the `gitterm` CLI's; the extension asks the questions and shows the outcome.
 */
export const PI_EXTENSION = String.raw`import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
const inbox = (id) => path.join(agentDir, "gitterm", "inbox", id + ".txt");
const records = path.join(process.env.HOME || homedir(), ".config", "gitterm", "moves.json");

/** The move that took this session to the cloud and has not come back, from gitterm's records. */
function movedTo(id) {
  try {
    const all = JSON.parse(readFileSync(records, "utf8"));
    return all.findLast((record) => record.agent === "pi" && record.localRef === id && !record.returnedAt);
  } catch {
    return undefined;
  }
}

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
  /** Runs the gitterm CLI: its JSON result, or its error ({ code, message }). */
  const gitterm = async (args) => {
    let result;
    try {
      result = await pi.exec("gitterm", [...args, "--json"], { timeout: 15 * 60_000 });
    } catch {
      return { error: { code: "MISSING", message: "The gitterm CLI is not installed: npm install -g @gitterm/cli" } };
    }
    if (result.code === 0) return { ok: JSON.parse(result.stdout) };
    try {
      return { error: JSON.parse(result.stderr).error };
    } catch {
      return { error: { code: "ERROR", message: (result.stderr || result.stdout).trim() || "gitterm failed." } };
    }
  };
  /** Shows in the footer whether this session is in the cloud. */
  const status = (ctx) => {
    const moved = movedTo(ctx.sessionManager.getSessionId());
    ctx.ui.setStatus("gitterm", moved ? "In a GitTerm cloud workspace: /cloud-return brings it back" : undefined);
    return moved;
  };
  const choose = async (ctx, title, options) => (ctx.hasUI ? ctx.ui.select(title, options) : options[0]);

  pi.on("session_start", async (event, ctx) => {
    status(ctx);
    // A session Pi opens at startup (the cloud's tmux, a terminal). After /cloud-return,
    // the replacement session delivers its own notice below.
    if (event.reason === "startup")
      deliver(ctx.sessionManager.getSessionId(), (text) => pi.sendUserMessage(text));
  });

  // While a session is in the cloud, a message sent here starts a second conversation.
  pi.on("input", async (event, ctx) => {
    // Typed, or from an RPC client; not a notice an extension sends (GitTerm's own included).
    if (event.source === "extension" || !ctx.hasUI) return { action: "continue" };
    const moved = movedTo(ctx.sessionManager.getSessionId());
    if (!moved) return { action: "continue" };
    const send = await ctx.ui.confirm(
      "This session is in the cloud",
      "It continues in cloud workspace " + moved.workspaceId + ". A message sent here is not seen there, and /cloud-return asks before replacing it. Send it here anyway?",
    );
    if (send) return { action: "continue" };
    ctx.ui.setEditorText(event.text);
    ctx.ui.notify("Not sent. Run /cloud-return to bring the session back.", "info");
    return { action: "handled" };
  });

  pi.registerCommand("cloud", {
    description: "Move this session and its checkout to a GitTerm cloud workspace",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const id = ctx.sessionManager.getSessionId();
      const moved = status(ctx);
      if (moved)
        return show("This session is already in cloud workspace " + moved.workspaceId + ". Run /cloud-return to bring it back.");
      let changes = true;
      const git = await pi.exec("git", ["-C", ctx.cwd, "status", "--porcelain"]).catch(() => undefined);
      if (git?.code === 0 && git.stdout.trim()) {
        const choice = await choose(ctx, "Bring your uncommitted changes to the cloud?", [
          "Yes (copies your edited and new files)",
          "No (starts from your last commit)",
        ]);
        if (!choice) return;
        changes = choice.startsWith("Yes");
      }
      ctx.ui.setStatus("gitterm", "Moving to the cloud…");
      const result = await gitterm([
        "move", "--agent", "pi", "--session", id,
        ...(changes ? [] : ["--no-changes"]),
        ...(args?.trim() ? [args.trim()] : []),
      ]);
      status(ctx);
      if (result.error) return show("Moving to the cloud failed: " + result.error.message);
      show([
        "Moved to a GitTerm cloud workspace. The conversation continues there.",
        ...Object.entries(result.ok.links ?? {}).map(([label, link]) => label + ": " + link),
        "Workspace: " + result.ok.workspaceId,
        ...(result.ok.warnings ?? []).map((warning) => "Warning: " + warning),
      ].join("\n"));
    },
  });

  pi.registerCommand("cloud-return", {
    description: "Bring this session back from its GitTerm cloud workspace",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const id = ctx.sessionManager.getSessionId();
      const file = ctx.sessionManager.getSessionFile();
      const moved = status(ctx);
      if (!moved || !file) return show("This session is not in the cloud. Run /cloud to move it there.");
      const choice = await choose(ctx, "Once it's back, the cloud workspace is…", [
        "Paused",
        "Deleted (with files Git ignores there, such as .env)",
        "Kept running",
      ]);
      if (!choice) return;
      const end = choice.startsWith("Deleted") ? "delete" : choice.startsWith("Kept") ? "keep" : "pause";
      const back = (force) => gitterm([
        "return", moved.workspaceId, "--session", id, "--end", end,
        ...(force ? ["--force"] : []),
        ...(args?.trim() ? ["--message", args.trim()] : []),
      ]);
      ctx.ui.setStatus("gitterm", "Bringing it back from the cloud…");
      let result = await back(false);
      if (
        result.error?.code === "NEEDS_CONFIRMATION" &&
        ctx.hasUI &&
        (await ctx.ui.confirm(
          "Replace what changed here since the move?",
          "Messages sent here or edits to this checkout since the session moved are replaced by the cloud's. Yours are kept: a copy of this session, a Git stash and a gitterm/before-return branch.",
        ))
      )
        result = await back(true);
      if (result.error) {
        status(ctx);
        return show("Bringing it back failed: " + result.error.message);
      }
      // The session file now holds the cloud's conversation: open it again from disk.
      await ctx.switchSession(file, {
        withSession: async (next) => deliver(id, (text) => next.sendUserMessage(text)),
      });
    },
  });
}
`;
