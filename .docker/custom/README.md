# GitTerm browser terminal

A standalone, pinned npm package. The production artifact is one self-contained
`dist/index.html`, served by upstream ttyd's `--index` option. It uses Preact and
xterm's public APIs; no ttyd frontend files or C sources are overwritten.

## Local development

```sh
cd .docker/custom
npm ci
npm run check-types
npm run build
ttyd --writable --index "$PWD/dist/index.html" bash
```

`npm run dev` rebuilds the HTML on source changes; refresh the terminal page to
load it. Use a disposable shell for local development, or tmux for continuity.
The mock server (`node tests/server.mjs`) is only a test fixture, not a real PTY.

## Structure

- `src/main.tsx`: shell, optional draft editor, accessory keys, shortcut settings.
- `src/terminal.ts`: xterm lifecycle, paste policy, negotiated arrow keys, fitting.
- `src/connection.ts`: ttyd protocol, connection state, bounded reconnect backoff,
  output backpressure, user-activity reporting.
- `src/touch.ts`: horizontal panning and vertical scroll routing through xterm.
- `src/viewport.ts`: visual-viewport tracking with pinch-zoom preservation.
- `src/storage.ts`: optional preferences that tolerate blocked browser storage.
- `session.sh` / `tmux.conf`: one persistent terminal per workspace.

## Interaction

Fit is the default; Wide uses a terminal surface at least 1200px wide or 150% of
the viewport, whichever is larger, with horizontal panning. OpenCode itself decides its sidebar layout. Choose Settings → OpenCode
shortcuts to expose Sidebar; the configurable JSON key sequence defaults to
`"\u0018b"` (Ctrl-X then b). Match it to your OpenCode bindings. Application mode
is intentionally reset on reconnect; turn it off when using a shell. The browser
cannot reliably identify the active application from a terminal byte stream.

Keyboard focuses the real terminal input. Draft opens a separate local editor;
Insert pastes at the active terminal cursor **without submitting or replacing
existing terminal text**. Enter submits separately. All draft insertion requires
the application to enable bracketed paste. Drafts remain available after sending
until explicitly cleared, so startup races cannot erase the local copy. Avoid
pressing Insert twice unless you intend to paste twice. Drafts are in memory only
and are lost on page reload; preferences alone
are saved in localStorage. Successful insertion means queued to the live socket,
not acknowledged by the application: ttyd has no input acknowledgement protocol.
Paste mode can be enabled before OpenCode's prompt is ready during startup.
After Insert, the editor closes so you can inspect the prompt; the notice explicitly
does not claim delivery. If the text is missing, wait for the prompt and reopen
Draft to insert the retained text. There is no automatic retry that could duplicate input.

The renderer is xterm's canvas addon, which draws block and box glyphs without
relying on DOM font fallback. File-transfer/image addons from ttyd's
stock UI are not included (they were disabled in the previous GitTerm client).
The small adapter currently consumes the `disableStdin` server preference;
other stock ttyd frontend options are not implemented.

## Session continuity

The runtime requires the image's `/usr/local/bin/opencode` to report version 2.x,
bypassing older executables in the persisted workspace's PATH. UTF-8 is explicitly
enabled for tmux (`-u`) and the process locale to preserve TUI block glyphs. It starts a tmux
session named `workspace-v2` on the `gitterm` socket, separate from older sessions. ttyd
owns an attached client; losing its WebSocket detaches that client, leaving the
OpenCode process, prompt, and shell state alive. Tabs share this terminal; the
most recently sized client controls its size. There is no tmux prefix to intercept
OpenCode's Ctrl-B. Returning to a tab leaves a live connection intact; only a
disconnected client reconnects. Dead-peer detection is handled by ttyd's WebSocket
transport, with manual Reconnect available in Settings or on connection loss. Container shutdown still ends the terminal process; this is
not cross-container PTY persistence. Existing OpenCode session storage remains in
the workspace. Deliberately exiting the shell lets the next connection start anew.

## Verification and upgrades

```sh
npx playwright install chromium webkit
npm test
# From repository root:
docker build --target terminal-test -f .docker/Opencode.Dockerfile -t gitterm-terminal:test .docker
# From .docker/custom:
npm run test:session
```

The browser chrome uses the GitTerm logo, with connection status shown only on
connection loss or in read-only mode. The accessory key bar is only shown on
touch-first devices (`pointer: coarse`); desktop uses its physical keyboard.
Enter, Keyboard, and Draft stay pinned;
additional keys scroll separately. Settings and Draft are overlays, so opening
them does not resize the PTY. Short visual viewports compact the controls and
hide the top header below 300px to preserve terminal rows.

CI checks types, builds, runs Chromium/mobile-WebKit behavioral tests, and tests
real ttyd/tmux reconnection with the same shell PID and environment. Test screenshots
are written to `test-results`. These tests simulate viewport changes; physical
iOS/Android keyboard, IME/dictation, pinch zoom, and gesture testing are still part
of release QA. Run OpenCode itself for final plugin/sidebar/permission checks.

Update npm dependencies and `package-lock.json` together, then run those checks.
Update `TTYD_COMMIT` in `Opencode.Dockerfile` independently and rerun the transport
integration test. Production builds still use `.docker` as their Docker context
and `linux/amd64` for the AWS SAM/runtime library paths. Legacy source overrides
and backups are available in git history.
