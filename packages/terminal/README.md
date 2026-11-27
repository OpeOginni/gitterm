# GitTerm browser terminal

The page every terminal agent (Pi today, any TUI agent later) runs in. Upstream ttyd serves
it unmodified with `--index`; the agent runs in one tmux session that every browser attaches
to, so it keeps running when the browser closes.

- `src/`: the page, one self-contained `dist/index.html` (Preact and xterm).
- `session.sh`: what each browser connection runs. It attaches to the tmux session that runs the
  agent, or saves an upload.
- `tmux.conf`: tmux kept out of the way, so the agent gets every key.

## Adding an agent

An agent fills in a `TerminalAgent` (`@gitterm/schema/terminal`): its name, the command to
run, and shortcuts for the touch key bar. Its provisioner writes `terminalFiles()` and serves
`terminalServeCommand(port, agent)`, as Pi does (`packages/api/src/service/agents/pi.ts`). Its
install command includes `TERMINAL_INSTALL_COMMAND`. ttyd hands the name and keys to the page
as the `gitterm` client option. Nothing else is agent-specific.

## What the page does

- **Touch screens** get one row of keys (Esc, Tab, sticky Ctrl, ↑ and ↓ for menus and
  history, the agent's keys) and a composer. Send pastes the message as one paste,
  then presses Enter on its own, so autocorrect, dictation and multi-line prompts work. Tap the terminal to type into it
  directly. A long press shows the screen as plain text, to select with the phone's usual
  handles.
- **Copy**: what tmux or the agent copies (OSC 52) goes to the clipboard. If the browser
  refuses, a "Tap to copy" button appears.
- **Files**: the + button, dropping files or pasting them uploads to `~/.gitterm/uploads` and
  puts the path in the prompt, as Pi's own image paste does. The upload uses a second ttyd
  connection that runs `session.sh upload <name> <size>` (ttyd's `-a` URL arguments).
- **Attention**: while the tab is hidden, its title gets a `●` when the agent rings the bell
  or its output stops for 4 seconds (an idle Pi prints nothing).
- **Activity**: input pings `/token` at most once a minute, which the GitTerm proxy counts as
  activity. A long websocket alone would let the workspace go idle.

## Develop and test

```sh
bun run build          # dist/index.html, which the server and the OpenCode image ship
bun run dev            # rebuild on change
bun run test           # Playwright against tests/server.ts, a stand-in for ttyd
bun run test:session   # Docker: real ttyd and tmux, installed and served as a workspace does
```

The server imports the built page, so build this package before running the server or its
tests (`bun run dev:server` and CI do).
