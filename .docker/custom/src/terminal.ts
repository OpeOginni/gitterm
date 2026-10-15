import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { CanvasAddon } from "@xterm/addon-canvas";
import { Connection, type ConnectionState } from "./connection";
import { attachTouch } from "./touch";
import "@xterm/xterm/css/xterm.css";

export class BrowserTerminal {
  private terminal = new Terminal({
    fontSize: 13,
    fontFamily: "Menlo, Consolas, monospace",
    scrollback: 10_000,
    allowProposedApi: true,
    theme: { background: "#09090b", foreground: "#e0e0e0", cursor: "#d6b65c" },
  });
  private fitAddon = new FitAddon();
  private cleanup: (() => void)[] = [];
  private frame = 0;
  private readonly = false;
  private lastSend = false;
  private connection: Connection;

  constructor(parent: HTMLElement, onState: (state: ConnectionState, readonly: boolean) => void) {
    const terminal = this.terminal;
    terminal.loadAddon(this.fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    terminal.open(parent);
    // Draw block/box glyphs as terminal cells rather than relying on font fallback.
    terminal.loadAddon(new CanvasAddon());
    this.fitAddon.fit();
    this.connection = new Connection({
      state: (state) => {
        terminal.options.disableStdin = state !== "connected" || this.readonly;
        onState(state, this.readonly);
      },
      size: () => ({ cols: terminal.cols, rows: terminal.rows }),
      output: (data, done) => terminal.write(data, done),
      reset: () => terminal.reset(),
      preferences: (prefs) => {
        this.readonly = prefs.disableStdin === true;
      },
    });
    const data = terminal.onData((value) => {
      this.lastSend = this.send(value);
    });
    const binary = terminal.onBinary((value) =>
      this.send(Uint8Array.from(value, (char) => char.charCodeAt(0))),
    );
    const resize = terminal.onResize(({ cols, rows }) => this.connection.resize(cols, rows));
    const observer = new ResizeObserver(() => this.fit());
    observer.observe(parent);
    const touch = attachTouch(terminal, parent.parentElement!, () => this.connection.activity());
    const visibility = () => {
      if (document.visibilityState === "visible") this.connection.resume();
    };
    const online = () => this.connection.resume();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    this.cleanup.push(
      () => data.dispose(),
      () => binary.dispose(),
      () => resize.dispose(),
      () => observer.disconnect(),
      touch,
      () => document.removeEventListener("visibilitychange", visibility),
      () => window.removeEventListener("online", online),
    );
    void this.connection.connect();
  }

  send(value: string | Uint8Array) {
    return !this.readonly && this.connection.send(value);
  }

  paste(value: string): boolean {
    if (!this.connection.connected || this.readonly) return false;
    // Paste mode permits safe framing, but does NOT prove prompt readiness.
    // The UI retains drafts because ttyd cannot acknowledge application delivery.
    if (!this.terminal.modes.bracketedPasteMode) return false;
    this.lastSend = false;
    this.terminal.paste(value);
    return this.lastSend;
  }

  arrow(direction: string) {
    return this.send(
      `\x1b${this.terminal.modes.applicationCursorKeysMode ? "O" : "["}${direction}`,
    );
  }
  focus() {
    this.terminal.focus();
  }
  fit() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.fitAddon.fit());
  }
  reconnect() {
    void this.connection.connect();
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.connection.dispose();
    this.cleanup.forEach((dispose) => dispose());
    this.terminal.dispose();
  }
}
