import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { CanvasAddon } from "@xterm/addon-canvas";
import { Connection, type ConnectionState } from "./connection";
import { attachTouch } from "./touch";
import "@xterm/xterm/css/xterm.css";

/** What ttyd's `-t gitterm=...` option tells the page about the agent. */
export type Agent = { name: string; keys: { label: string; send: string }[] };

export type TerminalEvents = {
  state(state: ConnectionState): void;
  agent(agent: Agent): void;
  /** Output arrived: the agent is working (or done, once it stops). */
  output(): void;
  bell(): void;
  /** The agent or tmux copied text (OSC 52). */
  copy(text: string): void;
  /** A long press asked to select the screen's text (touch screens can't select in it). */
  select(text: string): void;
  /** The key bar's sticky Ctrl, which applies to the next key typed. */
  ctrl(on: boolean): void;
};

export class BrowserTerminal {
  private terminal = new Terminal({
    fontSize: 13,
    fontFamily: 'ui-monospace, Menlo, "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace',
    scrollback: 10_000,
    allowProposedApi: true,
    theme: { background: "#09090b", foreground: "#e0e0e0", cursor: "#d6b65c" },
  });
  private fitAddon = new FitAddon();
  private cleanup: (() => void)[] = [];
  private frame = 0;
  private connection: Connection;
  private ctrl = false;

  constructor(
    parent: HTMLElement,
    private events: TerminalEvents,
  ) {
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
        terminal.options.disableStdin = state !== "connected";
        events.state(state);
      },
      size: () => ({ cols: terminal.cols, rows: terminal.rows }),
      output: (data, done) => {
        terminal.write(data, done);
        events.output();
      },
      reset: () => terminal.reset(),
      preferences: (prefs) => {
        const agent = prefs.gitterm as Agent | undefined;
        if (agent?.name) events.agent({ name: agent.name, keys: agent.keys ?? [] });
      },
    });
    const osc52 = terminal.parser.registerOscHandler(52, (data) => {
      const encoded = data.slice(data.indexOf(";") + 1);
      // "?" asks to read the clipboard, which the page never answers.
      if (encoded !== "?") {
        try {
          const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
          events.copy(new TextDecoder().decode(bytes));
        } catch {}
      }
      return true;
    });
    const data = terminal.onData((value) => this.type(value));
    const binary = terminal.onBinary((value) =>
      this.send(Uint8Array.from(value, (char) => char.charCodeAt(0))),
    );
    const bell = terminal.onBell(() => events.bell());
    const resize = terminal.onResize(({ cols, rows }) => this.connection.resize(cols, rows));
    const observer = new ResizeObserver(() => this.fit());
    observer.observe(parent);
    const touch = attachTouch(
      terminal,
      () => this.connection.activity(),
      () => events.select(this.screenText()),
    );
    const visibility = () => {
      if (document.visibilityState === "visible") this.connection.resume();
    };
    const online = () => this.connection.resume();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    this.cleanup.push(
      () => osc52.dispose(),
      () => data.dispose(),
      () => binary.dispose(),
      () => bell.dispose(),
      () => resize.dispose(),
      () => observer.disconnect(),
      touch,
      () => document.removeEventListener("visibilitychange", visibility),
      () => window.removeEventListener("online", online),
    );
    void this.connection.connect();
  }

  toggleCtrl() {
    this.ctrl = !this.ctrl;
    this.events.ctrl(this.ctrl);
    this.terminal.focus();
  }

  /** Typed input, with the key bar's sticky Ctrl applied to a single key. */
  private type(value: string) {
    if (this.ctrl && value.length === 1) {
      this.ctrl = false;
      this.events.ctrl(false);
      const code = value.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) value = String.fromCharCode(code - 64);
    }
    this.send(value);
  }

  send(value: string | Uint8Array) {
    return this.connection.send(value);
  }

  /**
   * Types text as one paste, then Enter on its own after a moment, as an agent treats an Enter
   * inside a paste as a new line. "sent" only once Enter went out on the connection the paste
   * did. Several lines need a bracketed paste (the agent's prompt asks for one), or each line
   * would be sent as it arrives: "multiline" when the prompt didn't ask.
   */
  async submit(text: string): Promise<"sent" | "multiline" | "dropped"> {
    if (!this.connection.connected) return "dropped";
    if (text.includes("\n") && !this.terminal.modes.bracketedPasteMode) return "multiline";
    const id = this.connection.id;
    if (text) {
      this.terminal.paste(text);
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.connection.id !== id) return "dropped";
    }
    return this.send("\r") ? "sent" : "dropped";
  }

  /** Pastes as the terminal would (bracketed when the program asked for it), if connected. */
  paste(text: string): boolean {
    if (!this.connection.connected) return false;
    this.terminal.paste(text);
    return true;
  }

  arrow(direction: string) {
    return this.send(
      `\x1b${this.terminal.modes.applicationCursorKeysMode ? "O" : "["}${direction}`,
    );
  }

  /** The text on screen. */
  private screenText(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < this.terminal.rows; row++) {
      lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "");
    }
    return lines.join("\n").trimEnd();
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
