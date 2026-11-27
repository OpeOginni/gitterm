import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { BrowserTerminal, type Agent } from "./terminal";
import type { ConnectionState } from "./connection";
import { upload } from "./upload";
import { observeViewport } from "./viewport";
import "./style.css";

type Notice = { text: string; copy?: string };

/** After this long without output in a hidden tab, the agent is probably done or waiting. */
const QUIET_MS = 4000;

const touch = () => matchMedia("(pointer: coarse)").matches;

function App() {
  const shell = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const terminal = useRef<BrowserTerminal>();
  const [state, setState] = useState<ConnectionState>("connecting");
  const [agent, setAgent] = useState<Agent>({ name: "Terminal", keys: [] });
  const [ctrl, setCtrl] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<Notice>();
  const [screen, setScreen] = useState<string>();
  const connected = state === "connected";

  useEffect(() => {
    const viewport = observeViewport(shell.current!);
    let name = "Terminal";
    let quiet: ReturnType<typeof setTimeout> | undefined;
    // A hidden tab's title says when the agent may need you: output went quiet, or a bell.
    const attention = () => {
      if (document.hidden) document.title = `● ${name}`;
    };
    const visible = () => {
      if (!document.hidden) document.title = name;
    };
    document.addEventListener("visibilitychange", visible);
    const adapter = new BrowserTerminal(container.current!, {
      state: setState,
      agent: (next) => {
        name = next.name;
        document.title = name;
        setAgent(next);
      },
      output: () => {
        if (!document.hidden) return;
        clearTimeout(quiet);
        quiet = setTimeout(attention, QUIET_MS);
      },
      bell: attention,
      ctrl: setCtrl,
      select: setScreen,
      copy: (text) =>
        navigator.clipboard.writeText(text).then(
          () => setNotice({ text: "Copied" }),
          // Some browsers allow it only in a tap, so offer one.
          () => setNotice({ text: "Tap to copy", copy: text }),
        ),
    });
    terminal.current = adapter;
    return () => {
      clearTimeout(quiet);
      document.removeEventListener("visibilitychange", visible);
      viewport();
      adapter.dispose();
      terminal.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), notice.copy ? 15_000 : 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  /** Uploads files and puts their paths where the next message is typed. */
  const attach = async (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      setNotice({ text: `Uploading ${file.name}…` });
      try {
        const path = await upload(file);
        if (touch()) setDraft((text) => `${text}${text && !text.endsWith(" ") ? " " : ""}${path} `);
        else terminal.current?.paste(`${path} `);
        setNotice({ text: `Uploaded ${file.name}` });
      } catch (error) {
        setNotice({ text: (error as Error).message });
      }
    }
  };

  useEffect(() => {
    const host = shell.current!;
    const paste = (event: ClipboardEvent) => {
      const pasted = event.clipboardData?.files;
      if (!pasted?.length) return;
      event.preventDefault();
      event.stopPropagation();
      void attach(pasted);
    };
    const over = (event: DragEvent) => event.preventDefault();
    const drop = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer?.files.length) void attach(event.dataTransfer.files);
    };
    host.addEventListener("paste", paste, true);
    host.addEventListener("dragover", over);
    host.addEventListener("drop", drop);
    return () => {
      host.removeEventListener("paste", paste, true);
      host.removeEventListener("dragover", over);
      host.removeEventListener("drop", drop);
    };
  }, []);

  const send = () => {
    if (terminal.current?.submit(draft)) setDraft("");
  };
  const key = (label: string, onClick: () => void, name = label) => (
    <button
      key={name}
      aria-label={name}
      disabled={!connected}
      // Keep the focus (and the software keyboard) where it is.
      onPointerDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
  const keySend = (value: string) => () => terminal.current?.send(value);

  return (
    <div ref={shell} data-connection={state} class="workspace-shell">
      {!connected && (
        <div class="connection-bar">
          <span role="status">{state === "connecting" ? "Connecting…" : "Disconnected"}</span>
          <button onClick={() => terminal.current?.reconnect()}>Reconnect</button>
        </div>
      )}
      <main class="terminal-shell" aria-label={agent.name}>
        <div id="terminal-container" ref={container} />
      </main>
      <section class="touch-bar" aria-label="Input">
        <div class="keys" role="toolbar" aria-label="Keys">
          {key("Esc", keySend("\x1b"))}
          {key("Tab", keySend("\t"))}
          <button
            aria-pressed={ctrl}
            disabled={!connected}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => terminal.current?.toggleCtrl()}
          >
            Ctrl
          </button>
          {/* Up and down pick from menus and history; the composer does the editing. */}
          {key("↑", () => terminal.current?.arrow("A"), "Up")}
          {key("↓", () => terminal.current?.arrow("B"), "Down")}
          {agent.keys.map(({ label, send }) => key(label, keySend(send)))}
        </div>
        <div class="composer">
          <button aria-label="Attach files" onClick={() => files.current?.click()}>
            +
          </button>
          <textarea
            rows={1}
            value={draft}
            placeholder={`Message ${agent.name}`}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <button class="send" disabled={!connected} onClick={send}>
            Send
          </button>
          <input
            ref={files}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const input = event.currentTarget;
              if (input.files?.length) void attach(input.files).finally(() => (input.value = ""));
            }}
          />
        </div>
      </section>
      {screen !== undefined && (
        <section class="screen-text" aria-label="Screen text">
          <button onClick={() => setScreen(undefined)}>Close</button>
          <pre>{screen}</pre>
        </section>
      )}
      {notice &&
        (notice.copy ? (
          <button
            class="notice"
            onClick={() =>
              navigator.clipboard.writeText(notice.copy!).then(() => setNotice({ text: "Copied" }))
            }
          >
            {notice.text}
          </button>
        ) : (
          <p class="notice" role="status">
            {notice.text}
          </p>
        ))}
    </div>
  );
}

render(<App />, document.getElementById("app")!);
