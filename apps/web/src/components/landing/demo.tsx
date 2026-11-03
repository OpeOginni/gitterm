import type { CSSProperties, ReactNode } from "react";
import { Wrap } from "@/components/site/section";
import { Logo } from "./logo";
import { ModeSwitch } from "./mode-switch";

/*
 * The demo session: a full-width OpenCode TUI with a status bar, and the macOS windows that
 * float around it. The engine (engine.ts) fills the transcript and moves the windows; the class
 * names here are styled in landing.css.
 */

const width = (px: number) => ({ "--w": `${px}px` }) as CSSProperties;
const appColor = (c: string, fg?: string) =>
  ({ "--c": c, ...(fg ? { color: fg } : {}) }) as CSSProperties;

const OpenIcon = () => (
  <svg
    className="si-open"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    aria-hidden
  >
    <rect x="2.5" y="3.5" width="11" height="9" rx="2" />
    <path d="M2.5 6h11" />
  </svg>
);

function Lights({ close = true }: { close?: boolean }) {
  return (
    <span className="fw-lights">
      {close ? <button type="button" className="l-close" aria-label="Close window" /> : <i />}
      <i />
      <i />
    </span>
  );
}

function StatusItem({
  name,
  label,
  children,
  on,
}: {
  name: string;
  label: string;
  children: ReactNode;
  on?: boolean;
}) {
  return (
    <button type="button" className={on ? "si on" : "si"} data-for={name} aria-expanded="false">
      <OpenIcon />
      <span className="si-lbl">
        <i />
        {label}
      </span>
      {children}
    </button>
  );
}

export function Demo() {
  return (
    <section id="demo" aria-label="Demo session" className="pb-[clamp(64px,9vw,112px)]">
      <Wrap wide>
        <ModeSwitch />

        <div className="demo-stage" id="bench">
          <div className="tui main" aria-label="OpenCode in the terminal">
            <div className="tui-chrome">
              <span className="lights" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="title">opencode · ~/code/shop</span>
            </div>
            <div className="tui-scroll" id="scroll">
              <div id="transcript" aria-live="polite" />
            </div>
            <div className="t-prompt">
              <div className="t-input" id="input">
                <span className="t-caret" />
              </div>
              <div className="t-meta">
                <b>Build</b> · <span>Claude Sonnet 5.5</span> Anthropic
              </div>
            </div>
            <div className="t-hints" id="hints" />
            <div
              className="sbar"
              role="toolbar"
              aria-label="What this session is using. Hover for a preview, click to open."
            >
              <StatusItem name="laptop" label="Your laptop" on>
                <span className="si-val">
                  <span id="sb-cpu">CPU 6%</span>
                  <span className="dim" id="sb-bat">
                    92%
                  </span>
                </span>
                <i className="si-meter" id="sb-meter" />
              </StatusItem>
              <StatusItem name="sandbox" label="Sandbox">
                <span className="si-val" data-sv="sandbox" />
              </StatusItem>
              <StatusItem name="preview" label="Preview">
                <span className="si-val" data-sv="preview" />
              </StatusItem>
              <StatusItem name="cloud" label="Cloud workspace">
                <span className="si-val" data-sv="cloud" />
              </StatusItem>
            </div>
          </div>

          <div className="coach" id="coach" aria-hidden>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}>
              <path d="M4 2.5v10l2.8-2.6 1.8 4 1.6-.7-1.8-4H12L4 2.5Z" strokeLinejoin="round" />
            </svg>
            Tap to open
          </div>

          <section className="fw" data-win="laptop" aria-label="Your laptop" style={width(270)}>
            <div className="fw-bar">
              <Lights />
              <span className="fw-title">Activity Monitor</span>
            </div>
            <div className="slot on" data-slot="laptop">
              <div className="panel">
                <div className="panel-body">
                  <div className="meter">
                    <div className="meter-row">
                      CPU<b id="cpu">6%</b>
                    </div>
                    <div className="bar">
                      <i id="cpubar" style={{ width: "6%" }} />
                    </div>
                  </div>
                  <div className="meter">
                    <div className="meter-row">
                      Memory<b id="mem">4.8 of 16 GB</b>
                    </div>
                    <div className="bar">
                      <i id="membar" style={{ width: "30%" }} />
                    </div>
                  </div>
                  <div className="meter">
                    <div className="meter-row">
                      Battery<b id="bat">92%, 7h left</b>
                    </div>
                    <div className="bar">
                      <i id="batbar" style={{ width: "92%" }} />
                    </div>
                  </div>
                  <ul className="procs" id="procs">
                    <li>
                      opencode<span>idle</span>
                    </li>
                  </ul>
                </div>
                <div className="panel-foot">
                  <div className="status" id="status">
                    Waiting for a request.
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="fw" data-win="sandbox" aria-label="Sandbox" style={width(380)}>
            <div className="fw-bar">
              <Lights />
              <span className="fw-title">
                <Logo src="/E2B.svg" data-plogo />
                <span>
                  <span data-pname>E2B</span> sandbox
                </span>
              </span>
              <span className="fw-meta">sbx_7f3a2c</span>
            </div>
            <div className="slot" data-slot="sandbox">
              <div className="empty">
                <strong>No sandbox yet</strong>
                <span data-empty />
              </div>
              <div className="panel">
                <div className="panel-body">
                  <pre className="term" id="term" />
                </div>
                <div className="panel-foot" id="sbxfoot">
                  Gitterm plan, 60 minute lifetime
                </div>
              </div>
            </div>
          </section>

          <section
            className="fw browserwin"
            data-win="preview"
            aria-label="Preview of port 3000"
            style={width(296)}
          >
            <div className="fw-bar">
              <Lights />
              <span className="fw-url" id="pvfoot" title="Private: only you can open it">
                <svg
                  className="ic-lock"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.2}
                  aria-hidden
                >
                  <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
                  <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
                </svg>
                <svg
                  className="ic-globe"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.2}
                  aria-hidden
                >
                  <circle cx="6" cy="6" r="4.5" />
                  <path d="M1.5 6h9M6 1.5c1.4 1.4 1.4 7.6 0 9M6 1.5c-1.4 1.4-1.4 7.6 0 9" />
                </svg>
                <span>3000-7f3a2c9e41d8b0a5c3f2.gitterm.dev</span>
              </span>
            </div>
            <div className="slot" data-slot="preview">
              <div className="empty">
                <strong>No preview yet</strong>
                <span data-empty />
              </div>
              <div className="panel">
                <div className="shop">
                  <h4>Checkout</h4>
                  <div className="row">
                    <span>Linen overshirt, M</span>
                    <span>€89.00</span>
                  </div>
                  <div className="row">
                    <span>Canvas tote</span>
                    <span>€24.00</span>
                  </div>
                  <div className="coupon">
                    <span>AUTUMN10</span>
                    <b>Apply</b>
                  </div>
                  <p className="err">This code expired on 31 October.</p>
                  <div className="total">
                    <span>Total</span>
                    <span>€113.00</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="fw phone" data-win="cloud" aria-label="Your phone" style={width(268)}>
            <button type="button" className="l-close ph-close" aria-label="Put the phone away" />
            <div className="ph-frame">
              <div className="ph-screen">
                <div className="ph-status ph-grab">
                  <span>9:41</span>
                  <i className="ph-island" />
                  <span className="ph-sig">
                    <i />
                    <i />
                    <i />
                    <b>5G</b>
                  </span>
                </div>
                <div className="slot" data-slot="cloud">
                  <div className="empty ph-lock">
                    <div className="pl-time">18:42</div>
                    <div className="pl-date">Tuesday, 3 November</div>
                    <div className="pl-note">
                      <b className="pl-ic">+</b>
                      <div>
                        <strong>Gitterm</strong>
                        <span data-empty />
                      </div>
                    </div>
                  </div>
                  <div className="panel ph-app">
                    <div className="pa-head">
                      <strong>Run tests and preview checkout</strong>
                      <span className="pa-loc">
                        <Logo src="/E2B.svg" data-plogo />
                        <b data-pname>E2B</b>workspace
                      </span>
                    </div>
                    <div className="pa-msgs">
                      <div className="pa-user">
                        I have to leave for a train. Keep going and I’ll check from my phone.
                      </div>
                      <div className="pa-tool">
                        <i />
                        Cloud handoff<em>41 messages</em>
                      </div>
                      <p className="pa-text">
                        Restored here. Tests pass and the checkout preview is up.
                      </p>
                      <div className="pa-user">Looks good. Open the PR.</div>
                      <p className="pa-text">
                        Opened PR #482 from <code>gitterm/checkout-coupons</code>.
                      </p>
                    </div>
                    <div className="pa-composer">
                      <span>Ask anything…</span>
                      <b aria-hidden>↑</b>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Without Gitterm: what clicking gets you instead */}
          <section
            className="fw alert fq"
            data-alert="laptop"
            aria-label="Force Quit Applications"
            role="alertdialog"
            style={width(300)}
          >
            <div className="fw-bar">
              <Lights />
              <span className="fw-title">Force Quit Applications</span>
            </div>
            <div className="fq-body">
              <div className="fq-warn">
                <span className="ic-warn" aria-hidden />
                <div>
                  <strong>Your system has run out of application memory.</strong>
                  <p>
                    To avoid problems with your computer, quit any applications you are not using.
                  </p>
                </div>
              </div>
              <ul className="fq-list">
                <li className="sel">
                  <span className="app" style={appColor("#2496ed")}>
                    D
                  </span>
                  Docker Desktop<em>(paused)</em>
                  <b>9.8 GB</b>
                </li>
                <li>
                  <span className="app" style={appColor("#f6dece", "#111")}>
                    B
                  </span>
                  bun test<b>3.1 GB</b>
                </li>
                <li>
                  <span className="app" style={appColor("#5fa04e")}>
                    N
                  </span>
                  node (bun run dev)<b>1.2 GB</b>
                </li>
                <li>
                  <span className="app" style={appColor("#fafafa", "#111")}>
                    O
                  </span>
                  OpenCode<b>840 MB</b>
                </li>
                <li>
                  <span className="app" style={appColor("#4285f4")}>
                    C
                  </span>
                  Chrome<em>(not responding)</em>
                  <b>2.4 GB</b>
                </li>
              </ul>
              <div className="mac-btns">
                <button type="button" className="mac-btn" data-shake>
                  Force Quit
                </button>
              </div>
            </div>
          </section>
          <section
            className="fw alert dlg"
            data-alert="sandbox"
            role="alertdialog"
            aria-label="No sandbox"
            style={width(300)}
          >
            <div className="dlg-body">
              <span className="ic-warn big" aria-hidden />
              <strong>There is nowhere else to run this</strong>
              <p>Tests, Postgres and the dev server are all running on this Mac.</p>
              <div className="mac-btns vert">
                <button type="button" className="mac-btn" data-dismiss>
                  OK
                </button>
              </div>
            </div>
          </section>
          <section
            className="fw alert safari"
            data-alert="preview"
            role="alertdialog"
            aria-label="Safari can't open the page"
            style={width(360)}
          >
            <div className="fw-bar">
              <Lights />
              <span className="fw-title">localhost:3000/checkout</span>
            </div>
            <div className="safari-body">
              <span className="compass" aria-hidden />
              <strong>Safari can’t open the page</strong>
              <p>Your teammate can’t reach “localhost:3000”. It only exists on your Mac.</p>
            </div>
          </section>
          <section
            className="fw alert dlg"
            data-alert="cloud"
            role="alertdialog"
            aria-label="Close the lid?"
            style={width(300)}
          >
            <div className="dlg-body">
              <span className="ic-moon" aria-hidden />
              <strong>Close the lid?</strong>
              <p>
                OpenCode, Postgres and the dev server stop when your Mac sleeps. The session can’t
                come with you.
              </p>
              <div className="mac-btns vert">
                <button type="button" className="mac-btn" data-dismiss>
                  Keep it open
                </button>
                <button type="button" className="mac-btn ghost" data-dismiss>
                  Sleep anyway
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="mx-auto mt-[18px] flex min-h-10 max-w-[840px] items-center justify-end gap-4 max-[560px]:justify-between">
          <span className="text-[14px] text-fg-4" id="benchnote" aria-live="polite" />
          <ReplayButton id="replay" />
        </div>
        <noscript>
          <p className="mt-6 text-center text-fg-3">
            The demo session needs JavaScript. In short: the agent creates an E2B sandbox, syncs
            your files, runs the tests there, fixes a failing test locally, starts a preview, and
            then <code>/cloud</code> moves the session to a cloud workspace you can open from your
            phone.
          </p>
        </noscript>
      </Wrap>
    </section>
  );
}

/** Secondary button that restarts a demo (the engine wires the click by id). */
export function ReplayButton({ id }: { id: string }) {
  return (
    <button
      type="button"
      id={id}
      className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-white/[0.04] px-4 text-[14px] font-medium text-fg-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-colors hover:bg-white/[0.07] hover:text-fg"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden
        className="size-[15px]"
      >
        <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4M2.5 2.5v3h3" />
      </svg>
      Replay
    </button>
  );
}
