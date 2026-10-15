import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { BrowserTerminal } from "./terminal";
import type { ConnectionState } from "./connection";
import { observeViewport } from "./viewport";
import { readSetting, writeSetting } from "./storage";
import "./style.css";
import logo from "./logo.png";

function App() {
  const shell = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<BrowserTerminal>();
  const [state, setState] = useState<ConnectionState>("connecting");
  const [readonly, setReadonly] = useState(false);
  const [wide, setWide] = useState(() => readSetting("wide-terminal") === "true");
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useState(false);
  // Application mode is deliberately not persisted: the process may now be bash.
  const [opencode, setOpencode] = useState(false);
  const [shortcut, setShortcut] = useState(() => readSetting("sidebar-key", '"\\u0018b"'));
  const [compose, setCompose] = useState(false);
  const enabled = state === "connected" && !readonly;

  useEffect(() => {
    const viewport = observeViewport(shell.current!);
    const adapter = new BrowserTerminal(container.current!, (next, readOnly) => {
      setState(next);
      setReadonly(readOnly);
      if (next !== "connected") setOpencode(false);
    });
    terminal.current = adapter;
    return () => {
      viewport();
      adapter.dispose();
      terminal.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const insert = () => {
    if (!draft || !enabled) return;
    if (terminal.current?.paste(draft)) {
      setCompose(false);
      setMessage("Check the prompt: delivery is unconfirmed. Draft kept.");
    } else setMessage("Draft kept. Wait for the prompt to be ready, then try again.");
  };
  const panels = () => {
    try {
      const sequence: unknown = JSON.parse(shortcut);
      if (typeof sequence !== "string" || !sequence || sequence.length > 64) throw new Error();
      terminal.current?.send(sequence);
    } catch {
      setMessage("Sidebar shortcut must be a JSON string of 1–64 characters.");
    }
  };
  const keepFocus = (event: PointerEvent) => event.preventDefault();
  return (
    <div ref={shell} data-connection={state} class={`workspace-shell${wide ? " is-wide" : ""}`}>
      <header class="brand-bar">
        <img class="brand-logo" src={logo} alt="GitTerm" width="28" height="28" />
        <nav class="terminal-controls" aria-label="Terminal controls">
          {opencode && (
            <button disabled={!enabled} onPointerDown={keepFocus} onClick={panels}>
              Sidebar
            </button>
          )}
          <button
            aria-pressed={wide}
            onPointerDown={keepFocus}
            onClick={() => {
              setWide(!wide);
              writeSetting("wide-terminal", String(!wide));
            }}
          >
            {wide ? "Fit" : "Wide"}
          </button>
          <button
            aria-expanded={settings}
            onClick={() => {
              setSettings(!settings);
              setCompose(false);
            }}
          >
            Settings
          </button>
        </nav>
      </header>
      {(state !== "connected" || readonly) && (
        <div class="connection-bar">
          <span role="status">{readonly ? "Read only" : state}</span>
          {state !== "connected" && (
            <button onClick={() => terminal.current?.reconnect()}>Reconnect</button>
          )}
        </div>
      )}
      {settings && (
        <section class="settings" aria-label="Terminal settings">
          <button
            class="panel-close"
            onClick={() => setSettings(false)}
            aria-label="Close settings"
          >
            ×
          </button>
          <label>
            <input
              type="checkbox"
              checked={opencode}
              onChange={(event) => setOpencode(event.currentTarget.checked)}
            />
            OpenCode shortcuts (turn off when using a shell)
          </label>
          <label>
            Sidebar key sequence (JSON)
            <input
              aria-label="Sidebar key sequence"
              value={shortcut}
              onInput={(event) => {
                setShortcut(event.currentTarget.value);
                writeSetting("sidebar-key", event.currentTarget.value);
              }}
            />
          </label>
          <p>Default: Ctrl-X, then b. Set this to match your OpenCode keybindings.</p>
          <button
            onClick={() => {
              terminal.current?.reconnect();
              setSettings(false);
            }}
          >
            Reconnect
          </button>
        </section>
      )}
      <main class="terminal-shell" aria-label="Terminal">
        <div id="terminal-container" ref={container} />
      </main>
      <section class="mobile-input" aria-label="Terminal input">
        <div class="key-strip" role="toolbar" aria-label="Terminal keys">
          <div class="extra-keys">
            <button
              disabled={!enabled}
              onPointerDown={keepFocus}
              onClick={() => terminal.current?.send("\x1b")}
            >
              Esc
            </button>
            <button
              disabled={!enabled}
              onPointerDown={keepFocus}
              onClick={() => terminal.current?.send("\t")}
            >
              Tab
            </button>
            {(["D", "A", "B", "C"] as const).map((direction, index) => (
              <button
                key={direction}
                aria-label={["Left arrow", "Up arrow", "Down arrow", "Right arrow"][index]}
                disabled={!enabled}
                onPointerDown={keepFocus}
                onClick={() => terminal.current?.arrow(direction)}
              >
                {["←", "↑", "↓", "→"][index]}
              </button>
            ))}
            <button
              disabled={!enabled}
              onPointerDown={keepFocus}
              onClick={() => terminal.current?.send("\x03")}
            >
              Ctrl-C
            </button>
          </div>
          <div class="primary-keys">
            <button
              disabled={!enabled}
              onPointerDown={keepFocus}
              onClick={() => terminal.current?.send("\r")}
            >
              Enter
            </button>
            <button disabled={!enabled} onClick={() => terminal.current?.focus()}>
              Keyboard
            </button>
            <button
              aria-expanded={compose}
              onClick={() => {
                setCompose(!compose);
                setSettings(false);
              }}
            >
              Draft
            </button>
          </div>
        </div>
        {compose && (
          <div class="draft-editor">
            <button class="panel-close" onClick={() => setCompose(false)} aria-label="Close draft">
              ×
            </button>
            <label for="draft">
              Draft — inserts at the active terminal cursor; does not submit
            </label>
            <div class="compose-row">
              <textarea
                id="draft"
                rows={2}
                value={draft}
                spellcheck={false}
                autocapitalize="off"
                autocomplete="off"
                placeholder="Draft…"
                onInput={(event) => setDraft(event.currentTarget.value)}
              />
              <button disabled={!enabled || !draft} onPointerDown={keepFocus} onClick={insert}>
                Insert
              </button>
              <button
                disabled={!draft}
                onClick={() => {
                  setDraft("");
                  setMessage("");
                }}
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </section>
      {message && (
        <p class="input-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

render(<App />, document.getElementById("app")!);
