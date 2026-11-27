/**
 * The browser terminal a terminal agent (Pi today, any TUI agent later) runs in: upstream ttyd
 * serving GitTerm's page (`@gitterm/terminal`), attached to one tmux session the agent runs in,
 * so it keeps running when the browser closes. The server writes the page, `session.sh` and
 * `tmux.conf` to `TERMINAL_DIR`; this module has the commands that install and serve them.
 */

/** Where the page, `session.sh` and `tmux.conf` live in a workspace. */
export const TERMINAL_DIR = "~/.gitterm/terminal";
/** The tmux session the terminal attaches to (named in `session.sh`), which `gitterm move` also starts agents in. */
export const TERMINAL_TMUX_SESSION = "agent";
/** Basic auth password for the terminal, with the user `opencode` as GitTerm's clients send. */
export const TERMINAL_PASSWORD_ENV = "GITTERM_TERMINAL_PASSWORD";

const TTYD_VERSION = "1.7.7";

/** What every terminal agent fills in to run in the browser terminal. */
export type TerminalAgent = {
  /** The page's title and the composer's "Message <name>". */
  name: string;
  /** Run in the terminal's tmux session; a shell follows when it exits. */
  command: string;
  /** Keys a phone can't type, for the touch key bar beside Esc, Tab, Ctrl, ↑ and ↓. One or two fit. */
  keys: { label: string; send: string }[];
};

/**
 * Installs ttyd to `~/.local/bin` and, where the package manager allows it, tmux (which needs
 * root or sudo). Without tmux, each browser connection starts its own agent.
 */
export const TERMINAL_INSTALL_COMMAND = [
  'mkdir -p "$HOME/.local/bin"',
  `[ -x "$HOME/.local/bin/ttyd" ] || { curl -fsSL -o "$HOME/.local/bin/ttyd" "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.$(uname -m)" && chmod +x "$HOME/.local/bin/ttyd"; }`,
  'SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo -n"',
  "command -v tmux >/dev/null || { command -v apt-get >/dev/null && $SUDO apt-get update -qq && $SUDO apt-get install -y -qq tmux; } || { command -v dnf >/dev/null && $SUDO dnf install -y -q tmux; } || echo 'tmux is not installed: the agent stops when the browser terminal closes.'",
].join("\n");

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * Serves the agent in the browser terminal on `port`, password protected.
 * ttyd hands `-t` options to the page as JSON, so the page learns the agent from `gitterm`; it
 * splits an option at every `=`, so the JSON spells `=` as `\u003d`. `-a` lets the page pass
 * URL arguments to `session.sh`, which its uploads use.
 */
export function terminalServeCommand(port: number, { name, command, keys }: TerminalAgent): string {
  const options = JSON.stringify({ name, keys }).replaceAll("=", "\\u003d");
  const dir = "$HOME/.gitterm/terminal";
  return [
    'export PATH="$HOME/.local/bin:$PATH"',
    `exec ttyd --port ${port} --credential "opencode:$${TERMINAL_PASSWORD_ENV}" --writable --index "${dir}/index.html" -a -t ${quote(`gitterm=${options}`)} sh "${dir}/session.sh" ${quote(command)}`,
  ].join("; ");
}
