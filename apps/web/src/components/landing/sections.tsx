import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Band, PartHeading, SectionHead, Wrap } from "@/components/site/section";
import { CodeBlock } from "@/components/site/code-block";
import { CopyButton } from "@/components/site/copy-button";
import { Mark } from "@/components/site/mark";
import { GITHUB_URL, INSTALL_SETUP, SANDBOX_PROVIDERS, T3_LOGO } from "@/lib/site/providers";
import { SITE_URL } from "@/lib/docs/content";
import { cn } from "@/lib/utils";
import { ReplayButton } from "./demo";
import { AgentRoll, SetupCommand } from "./hero";
import { SoundToggle } from "./sound-toggle";
import { WorkspacesCard } from "./workspaces-card";
import { Logo } from "./logo";

const h3 = "m-0 mb-2 text-[17px] font-medium text-fg";
const cellText = "text-[15px] leading-[1.6] text-fg-3 [&_code]:text-fg";
/** Hairline grid: cells sit on the page colour with 1px gaps showing the line between them. */
const cells = "grid gap-px border border-line bg-line [&>*]:bg-background";

// ---------- Hero ----------

/**
 * Hover (or keyboard focus inside) draws a gold line along a cell's top, then down its right
 * edge, as one stroke; leaving undraws it in reverse. The cell must be `relative`, and its own
 * `::before` and `::after` stay free for this.
 */
const DRAW_EDGE =
  "transition-colors before:absolute before:-inset-x-px before:-top-px before:h-0.5 before:origin-left before:scale-x-0 before:bg-primary before:transition-transform before:delay-[220ms] before:duration-[400ms] before:ease-[cubic-bezier(0.22,1,0.36,1)] after:pointer-events-none after:absolute after:-top-px after:-right-px after:-bottom-px after:w-0.5 after:origin-top after:scale-y-0 after:bg-primary after:transition-transform after:delay-0 after:duration-[360ms] after:ease-[cubic-bezier(0.22,1,0.36,1)] focus-within:before:scale-x-100 focus-within:before:delay-0 focus-within:after:scale-y-100 focus-within:after:delay-[300ms] hover:bg-[#131317] hover:before:scale-x-100 hover:before:delay-0 hover:after:scale-y-100 hover:after:delay-[300ms]";

/**
 * A prompt to paste into a coding agent. It sends the agent to llms.txt instead of spelling out
 * setup steps here, so it stays right as the docs change, and it asks the user before acting.
 */
const SETUP_PROMPT = `Set up Gitterm for me. Read ${SITE_URL}/llms.txt first and follow the docs it links to. Don't guess at commands or config.

Before you change anything, ask me which of these I want:
1. Moving my agents' sessions to a cloud workspace and back. Run \`${INSTALL_SETUP}\`: it asks which agents to set up (OpenCode, Pi, T3 Code), adds a skill for other agents, and signs me in.
2. Remote sandboxes for my agents on this machine, for builds, tests and previews. The same setup command adds them. Ask whether I'll use a Gitterm plan or my own provider key. If I want to use my own key, offer only providers that support it. \`gitterm sandbox setup\` asks the same.
3. A cloud workspace that runs OpenCode, Pi, or T3 Code with Codex or Claude Code, started from ${SITE_URL}/dashboard.

Keep keys out of config files: use {env:VAR} references. When you're done, show me how to check that it works.`;

export function Hero() {
  return (
    // Fills the first screen under the 64px header, less a strip where the next section peeks in.
    <section className="flex min-h-[calc(100svh-64px-220px)] flex-col text-center">
      <Wrap className="relative flex-1 content-center py-12">
        <AgentRoll />
        <SetupCommand location="hero" className="mx-auto mt-10 max-w-[480px]" />
        {/* For people who'd rather hand setup to their agent: copy a prompt, no steps to follow. */}
        <p className="m-0 mt-5 text-[14px] text-fg-4">
          Or{" "}
          <CopyButton
            value={SETUP_PROMPT}
            label="copy a prompt"
            className="inline h-auto rounded-none bg-transparent px-0 text-[14px] font-normal text-fg-2 underline decoration-line-2 underline-offset-4 hover:bg-transparent hover:decoration-fg-3"
          />{" "}
          and let your agent set it up.
        </p>
      </Wrap>
    </section>
  );
}

/** Start in the browser, or read the code. At the end of the page. */
function CtaButtons() {
  return (
    <div className="mt-9 flex flex-wrap justify-center gap-3">
      <Link
        href="/dashboard"
        className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-[14.5px] font-medium text-primary-foreground transition-colors hover:bg-[#c09a45]"
      >
        Start a cloud workspace
      </Link>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-11 items-center rounded-lg bg-white/[0.04] px-5 text-[14.5px] font-medium text-fg-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-colors hover:bg-white/[0.07] hover:text-fg"
      >
        View on GitHub
      </a>
    </div>
  );
}

// ---------- Extend your laptop: the providers, which double as the demo's picker ----------

/** The demo's order: the white logos split up by the coloured ones. */
const DEMO_PROVIDERS = ["e2b", "daytona", "exe", "vercel", "boat", "aws"].flatMap((id) =>
  SANDBOX_PROVIDERS.filter((p) => p.id === id),
);

export function ProvidersStrip() {
  return (
    <section
      id="providers"
      aria-labelledby="prov-h"
      className="mt-6 mb-[30px] scroll-mt-20 text-center"
    >
      <Wrap>
        <PartHeading className="mb-2.5">Extend your laptop</PartHeading>
        <p id="prov-h" className="mx-auto max-w-[40rem] text-[15px] text-balance text-fg-3">
          Sandboxes run on the provider you choose.
        </p>
        {/* engine.ts lights the provider the demo is on and moves to one when it's clicked. */}
        <div
          data-prov-strip
          role="group"
          aria-label="Sandbox providers"
          className="mt-7 flex flex-wrap justify-center gap-x-[clamp(8px,3vw,28px)] gap-y-3 lg:gap-x-11"
        >
          {DEMO_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-prov={p.id}
              aria-pressed={p.id === "e2b"}
              className="group flex min-w-[76px] cursor-pointer max-[640px]:basis-[30%] flex-col items-center gap-2.5 rounded-lg px-2 py-2 text-[14px] text-fg-4 transition-colors duration-500 hover:text-fg-2 aria-pressed:text-fg max-[420px]:text-[12.5px]"
            >
              <Logo
                src={p.logo}
                className="size-8 object-contain opacity-40 grayscale transition-[filter,opacity,translate] duration-500 group-hover:opacity-80 group-hover:grayscale-0 group-aria-pressed:-translate-y-0.5 group-aria-pressed:opacity-100 group-aria-pressed:grayscale-0 max-[420px]:size-7 lg:size-9"
              />
              {p.name}
            </button>
          ))}
        </div>
      </Wrap>
    </section>
  );
}

// ---------- How Gitterm works: chapters beside a sticky TUI, as OpenCode or Pi ----------

const CHAPTERS: { title: string; body: ReactNode; used?: string[]; id?: string }[] = [
  {
    title: "Set up once",
    body: (
      <>
        <code>{INSTALL_SETUP}</code> adds Gitterm to your agents and asks where sandboxes run: your
        Gitterm plan, or your own provider key. Your agent, the conversation and your model keys
        stay on your laptop.
      </>
    ),
  },
  {
    title: "It borrows a machine when it needs one",
    body: (
      <>
        The agent starts a sandbox on the provider you set and syncs your working tree. Ignored
        files like <code>.env</code> stay home. Once it has saved a setup snapshot, the next sandbox
        starts with dependencies already installed.
      </>
    ),
    used: ["sandbox_create", "sandbox_sync"],
  },
  {
    title: "The heavy work runs there",
    body: "Tests, builds and dev servers run in the sandbox. The agent gets the output when a job finishes, or checks back on a long one, while your laptop stays idle.",
    used: ["sandbox_exec", "sandbox_job"],
  },
  {
    title: "Results come back to you",
    body: "A port becomes a preview URL you can open. Files changed in the sandbox only land in your checkout when the agent applies them.",
    used: ["sandbox_preview", "sandbox_apply"],
  },
  {
    id: "cloud",
    title: "Or take the whole session with you",
    body: (
      <>
        Run <code>{INSTALL_SETUP}</code> once, then type <code>/cloud</code>. The conversation, your
        unpublished commits and, if you choose, uncommitted changes move to a cloud workspace.
        OpenCode and Pi both support <code>/cloud</code> and <code>/cloud-return</code>. Your laptop
        copy stays as it was until you bring the session back.
      </>
    ),
  },
];

export function HowItWorks() {
  return (
    <Band id="how">
      <Wrap wide>
        <SectionHead title="How Gitterm works">
          The same session as above, one step at a time. Codex and Claude Code take the same steps
          with <code>gitterm sandbox</code>.
        </SectionHead>
        {/* The window takes OpenCode's or Pi's look; landing.css switches it on these radios. */}
        <input type="radio" name="how-agent" id="how-oc" className="sr-only" defaultChecked />
        <input type="radio" name="how-agent" id="how-pi" className="sr-only" />
        <div className="how-agents head" role="group" aria-label="Show the session in">
          <label htmlFor="how-oc">
            <Logo src="/opencode.svg" className="size-4" />
            OpenCode
          </label>
          <label htmlFor="how-pi">
            <Logo src="/pi.svg" className="size-4" />
            Pi
          </label>
        </div>
        <div className="story">
          <div className="chaps">
            {CHAPTERS.map((c, i) => (
              <article key={c.title} className="chap" data-scene={i} id={c.id}>
                {/* Phones only: the chapters stack, so each says where it sits in the story */}
                <span className="chap-n">
                  Step {i + 1} of {CHAPTERS.length}
                </span>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
                {c.used && (
                  <p className="used">
                    {c.used.map((u) => (
                      <code key={u}>{u}</code>
                    ))}
                  </p>
                )}
                <div className="chap-scene" aria-hidden />
              </article>
            ))}
          </div>
          <div className="stage-col">
            <div className="stage">
              <div className="how-agents" role="group" aria-label="Show the session in">
                <label htmlFor="how-oc">
                  <Logo src="/opencode.svg" className="size-4" />
                  OpenCode
                </label>
                <label htmlFor="how-pi">
                  <Logo src="/pi.svg" className="size-4" />
                  Pi
                </label>
              </div>
              <div className="tui" aria-hidden>
                <div className="tui-chrome">
                  <span className="lights">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="title">
                    <span data-oc>opencode · ~/code/shop</span>
                    <span data-pi>π - shop</span>
                  </span>
                </div>
                <div className="scenes" id="scenes" />
                <div className="t-prompt">
                  <div className="t-input">
                    <span className="t-caret" />
                  </div>
                  <div className="t-meta" data-oc>
                    <b>Build</b> · <span>Claude Opus 5.5</span> Anthropic
                  </div>
                </div>
                <div className="t-hints" data-oc>
                  <span className="path">~/code/shop:checkout-coupons</span>
                  <span>
                    <kbd>shift+tab</kbd> agents&nbsp;&nbsp;&nbsp;<kbd>ctrl+p</kbd> commands
                  </span>
                </div>
                <div className="t-hints" data-pi>
                  <span className="path">~/code/shop (checkout-coupons)</span>
                  <span>(anthropic) claude-opus-5.5 • medium</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Wrap>
    </Band>
  );
}

// ---------- Keys ----------

/**
 * A card's logos, stacked so they overlap; hovering the card spreads them apart. A logo marked
 * `demo` follows the provider the demo is on (engine.ts swaps every `img[data-plogo]`).
 */
function LogoStack({ logos }: { logos: { src: string; demo?: boolean }[] }) {
  return (
    <div className="mb-5 flex">
      {logos.map((l, i) => (
        <span
          key={l.src}
          className={cn(
            "grid size-12 place-items-center rounded-xl bg-fill-2 shadow-[0_0_0_1px_var(--color-line),0_0_0_4px_var(--color-background)] backdrop-blur transition-[margin] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
            i > 0 && "-ml-4 group-hover:ml-2.5",
          )}
        >
          <Logo
            src={l.src}
            className="size-6 object-contain"
            {...(l.demo ? { "data-plogo": true } : {})}
          />
        </span>
      ))}
    </div>
  );
}

const OWN_KEY_LOGOS = ["e2b", "daytona", "exe", "vercel", "boat"].flatMap((id) =>
  SANDBOX_PROVIDERS.filter((p) => p.id === id && p.byoKey).map((p) => ({ src: p.logo })),
);

export function Keys() {
  return (
    <Band>
      <Wrap>
        <SectionHead title="Your key, our plan, or your server" />
        <div className={cn(cells, "grid-cols-3 max-[1100px]:grid-cols-1")}>
          {[
            {
              title: "Bring your own provider key",
              body: "No Gitterm account needed. It uses your provider's CLI login if it finds one, or takes the key, and the provider bills you directly.",
              logos: OWN_KEY_LOGOS,
              command: "gitterm sandbox setup",
            },
            {
              title: "Use your Gitterm plan",
              body: (
                <>
                  No provider account needed. Sandboxes count against your plan, and Gitterm stops
                  anything that outlives its deadline.
                </>
              ),
              logos: [{ src: "/gitterm.svg" }],
              command: "gitterm login",
            },
            {
              title: "Use your own Gitterm",
              body: "Replace the example URL with your server's API URL, then pick from the providers it offers.",
              logos: [{ src: "/gitterm.svg" }, { src: "/E2B.svg", demo: true }],
              command: "gitterm login --server https://gitterm.acme.dev/api",
            },
          ].map((k) => (
            // A subgrid, so logos, titles, text and commands line up across the cards.
            <div
              key={k.title}
              className="group row-span-4 grid min-w-0 grid-rows-subgrid gap-y-0 px-6 py-[26px] max-[640px]:px-[18px] max-[640px]:py-5"
            >
              <LogoStack logos={k.logos} />
              <h3 className={cn(h3, "mb-1.5")}>{k.title}</h3>
              <p className={cn(cellText, "mb-[18px]")}>{k.body}</p>
              <div className="flex min-w-0 items-center gap-3 self-end rounded-[10px] border border-line bg-[#0b0b0e] py-2 pr-2 pl-4">
                <code className="min-w-0 flex-1 break-words font-mono text-[13px] text-fg max-[640px]:text-[12px]">
                  <span className="text-primary">$ </span>
                  {k.command}
                </code>
                <CopyButton value={k.command} />
              </div>
            </div>
          ))}
        </div>
      </Wrap>
    </Band>
  );
}

// ---------- OpenCode desktop ----------

const Chevron = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
    <path d="M3 4.5 6 7.5 9 4.5" />
  </svg>
);

export function Desktop() {
  return (
    <Band id="desktop">
      <Wrap>
        <SectionHead title="Also in OpenCode desktop">
          Same plugin, same tools. Every sandbox call shows up as a row you can open, and a session
          you moved with <code>/cloud</code> pairs to the app with a one-time link.
        </SectionHead>
        <div className="desk framed">
          <div className="oc" aria-label="The same session in OpenCode desktop">
            <div className="oc-titlebar">
              <div className="oc-lights" aria-hidden>
                <i />
                <i />
                <i />
              </div>
              <div className="oc-tab">
                <i className="dot" />
                <span>Run tests and preview checkout</span>
              </div>
              <span className="oc-newtab" aria-hidden>
                +
              </span>
            </div>
            <div className="oc-card">
              <div className="oc-head">
                <span className="oc-loc">
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.3}
                    aria-hidden
                  >
                    <path d="M4.5 12.5a3 3 0 0 1-.3-6 4 4 0 0 1 7.7.9 2.6 2.6 0 0 1-.4 5.1h-7Z" />
                  </svg>
                  <span id="desk-loc">E2B workspace</span>&nbsp;· checkout-coupons
                </span>
                <span className="oc-title">Run tests and preview checkout</span>
                <span className="oc-review">Session changes 2 files</span>
              </div>
              <div className="oc-scroll" id="desk-scroll">
                <div className="oc-col" id="desk" />
              </div>
              <div className="oc-composer">
                <div className="oc-box">
                  <div className="oc-input">
                    <span className="ph">Ask anything, / for commands, @ for context…</span>
                  </div>
                  <div className="oc-bar">
                    <span className="b plus" aria-hidden>
                      +
                    </span>
                    <span className="b agent">
                      Build <Chevron />
                    </span>
                    <span className="b">
                      <span className="faint model-provider">Anthropic /&nbsp;</span>Claude Opus 5.5{" "}
                      <Chevron />
                    </span>
                    <span className="oc-send" aria-hidden>
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.6}>
                        <path d="M7 11.5V2.5M3 6.5l4-4 4 4" />
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {(["tl", "tr", "bl", "br"] as const).map((c) => (
            <span key={c} className={`x ${c}`} aria-hidden />
          ))}
        </div>
      </Wrap>
    </Band>
  );
}

// ---------- Part 2: cloud agents ----------

const WORKSPACE_LOGOS = SANDBOX_PROVIDERS.map((p) => p.logo);

function WorksWith({
  logo,
  logoClassName,
  name,
  children,
}: {
  logo: string;
  logoClassName?: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Logo src={logo} className={cn("mt-[3px] size-[22px]", logoClassName)} />
      <div>
        <p className="m-0 text-[15.5px] leading-7 font-medium text-fg">{name}</p>
        <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-[13.5px] leading-5 text-fg-4">
          {children}
        </p>
      </div>
    </div>
  );
}

export function Agents() {
  return (
    <Band id="agents" className="border-line-2">
      <Wrap>
        <PartHeading>Run agents in the cloud</PartHeading>
        <SectionHead title="Send sessions to the cloud. Bring them back.">
          Keep working from your phone, a browser, or another computer while your agent runs in the
          cloud.
        </SectionHead>
        {/* Codex and Claude Code sit under T3 Code, because T3 Code is what runs them. */}
        <div className="-mt-[18px] mb-[26px] flex flex-wrap items-start gap-x-10 gap-y-4">
          <span className="text-[15px] leading-7 text-fg-3 max-sm:basis-full max-sm:-mb-2">
            Works with
          </span>
          <WorksWith logo="/opencode.svg" name="OpenCode">
            Move existing sessions
          </WorksWith>
          <WorksWith logo="/pi.svg" name="Pi">
            Move existing sessions
          </WorksWith>
          <WorksWith logo={T3_LOGO} logoClassName="rounded-[5px]" name="T3 Code">
            Runs
            <Logo src="/openai-codex.svg" className="ml-0.5 size-[14px]" />
            Codex and
            <Logo src="/claude.svg" className="ml-0.5 size-[14px]" />
            Claude Code
          </WorksWith>
        </div>

        <div className="handoff" id="handoff">
          <div className="ho-clock" aria-hidden>
            <span id="ho-time">18:40</span>
            <small id="ho-day">Tuesday evening</small>
          </div>
          <div className="ho-lane">
            <section className="ho-win ho-local" aria-label="Your laptop">
              <div className="fw-bar">
                <span className="fw-lights">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="fw-title">Your laptop</span>
                <span className="fw-meta" id="ho-cpu">
                  CPU 92%
                </span>
              </div>
              <div className="ho-meter" aria-hidden>
                <i id="ho-cpubar" />
              </div>
              <ul className="sess" id="ho-local" aria-live="polite" />
            </section>
            <div className="ho-link" id="ho-link" aria-hidden>
              <i className="ho-pkt" />
            </div>
            <section className="ho-win ho-cloud" aria-label="Cloud workspaces">
              <div className="fw-bar">
                <span className="fw-lights">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="fw-title">Cloud workspaces</span>
                <span className="fw-meta">
                  <span className="stack">
                    {WORKSPACE_LOGOS.map((l) => (
                      <span key={l}>
                        <Logo src={l} />
                      </span>
                    ))}
                  </span>
                </span>
              </div>
              <div className="cards" id="ho-cards" aria-live="polite" />
            </section>
          </div>
          <div className="ho-caps" aria-hidden>
            <span>Your laptop</span>
            <span />
            <span>Any provider</span>
          </div>
        </div>
        <div className="mt-[18px] flex justify-end gap-2">
          <SoundToggle />
          <ReplayButton id="ho-replay" />
        </div>
        <HandoffDetails />
      </Wrap>
    </Band>
  );
}

function HandoffDetails() {
  return (
    <div className="mt-10 grid gap-6 border-t border-line pt-6 md:grid-cols-3 md:gap-10">
      <div>
        <h3 className={h3}>Move a session</h3>
        <p className={cellText}>
          Run <code>{INSTALL_SETUP}</code>, then use <code>/cloud</code> in OpenCode or Pi to move
          your conversation, commits, and uncommitted changes.
        </p>
      </div>
      <div>
        <h3 className={h3}>Bring it back</h3>
        <p className={cellText}>
          Use <code>/cloud-return</code> to pick up on your laptop without losing local edits. Save
          a snapshot to reuse the workspace setup next time.
        </p>
      </div>
      <div>
        <h3 className={h3}>Start fresh</h3>
        <p className={cellText}>
          Use T3 Code to start Codex or Claude Code in a new cloud workspace.
        </p>
      </div>
    </div>
  );
}

// ---------- Drive it from anywhere ----------

export function Anywhere() {
  const cell = "flex min-w-0 flex-col px-6 pt-[26px] pb-7";
  return (
    <Band id="anywhere">
      <Wrap>
        <SectionHead title="Drive it from anywhere">
          A workspace keeps running while you are away. Check in from your phone, hand work over in
          Slack, or start runs from your own code.
        </SectionHead>
        <div className={cn(cells, "grid-cols-2 max-[1000px]:grid-cols-1")}>
          <div className={cell}>
            <h3 className={h3}>Your phone or browser</h3>
            <p className={cn(cellText, "mb-5")}>
              Scan a QR code to open the workspace in the OpenCode app on your phone, or open it in
              any browser. Pause it when you are done and pick up later.
            </p>
            <WorkspacesCard />
          </div>
          <div className={cell}>
            <h3 className={h3}>
              Slack and Discord
              <span className="ml-3 inline-flex gap-2 align-[-2px]">
                <Logo src="/slack.svg" className="size-4" />
                <Logo src="/discord.svg" className="size-4" />
              </span>
            </h3>
            <p className={cn(cellText, "mb-5")}>
              Mention <code>@gitterm</code> in a channel. It works in a cloud workspace for that
              repo and answers in the thread. Self-host the bot from one Docker image.
            </p>
            <SlackThread />
          </div>
          <div className="col-span-full grid min-w-0 grid-cols-[minmax(0,17rem)_minmax(0,1fr)] items-center gap-x-9 gap-y-5 px-6 pt-[26px] pb-7 max-[1000px]:grid-cols-1">
            <div>
              <h3 className={h3}>Your own code</h3>
              <p className={cellText}>
                The SDK creates a workspace, starts a run and waits for the result. Use it from
                scripts, CI or your own tools.
              </p>
            </div>
            <CodeBlock code={SDK} copy className="min-w-0 max-[640px]:[&_pre]:text-[12px]">
              <SdkCode />
            </CodeBlock>
          </div>
        </div>
      </Wrap>
    </Band>
  );
}

const SDK = `const { workspace } = await client.workspaces.create({ repo: "https://github.com/acme/shop" });
const run = await client.runs.create({ workspace, prompt: "Fix the flaky checkout test." });
const { finalText } = await client.runs.result(run);`;

/** The SDK snippet with keywords in blue and strings in gold. */
const K = ({ children }: { children: ReactNode }) => (
  <span className="text-[#a2bcff]">{children}</span>
);
const S = ({ children }: { children: ReactNode }) => (
  <span className="text-[#e2c47c]">{children}</span>
);
const Bot = () => (
  <span className="sl-av bot">
    <Mark className="size-[56%]" />
  </span>
);

function SdkCode() {
  return (
    <>
      <K>const</K> {"{ workspace }"} = <K>await</K> client.workspaces.create({"{"} repo:{" "}
      <S>&quot;https://github.com/acme/shop&quot;</S> {"}"});
      {"\n"}
      <K>const</K> run = <K>await</K> client.runs.create({"{"} workspace, prompt:{" "}
      <S>&quot;Fix the flaky checkout test.&quot;</S> {"}"});
      {"\n"}
      <K>const</K> {"{ finalText }"} = <K>await</K> client.runs.result(run);
    </>
  );
}

/** A real-looking dark-mode Slack thread. */
function SlackThread() {
  return (
    <div className="slack" aria-label="Slack thread">
      <div className="sl-head">
        <b>Thread</b>
        <span># shop-dev</span>
      </div>
      <div className="sl-msg">
        <span className="sl-av" style={{ "--c": "#6d4bd8" } as CSSProperties}>
          A
        </span>
        <div className="sl-body">
          <div className="sl-meta">
            <b>Ada</b>
            <time>6:40 PM</time>
          </div>
          <p>
            <span className="sl-at">@gitterm</span> the checkout test is flaky again, can you take a
            look?
          </p>
          <div className="sl-reacts">
            <span className="sl-react">
              👀 <b>1</b>
            </span>
          </div>
        </div>
      </div>
      <div className="sl-div">
        <span>2 replies</span>
      </div>
      <div className="sl-msg">
        <Bot />
        <div className="sl-body">
          <div className="sl-meta">
            <b>gitterm</b>
            <i className="sl-app">APP</i>
            <time>6:41 PM</time>
          </div>
          <p>
            On it. Working in <span className="sl-code">acme/shop</span> in a cloud workspace.
          </p>
        </div>
      </div>
      <div className="sl-msg">
        <Bot />
        <div className="sl-body">
          <div className="sl-meta">
            <b>gitterm</b>
            <i className="sl-app">APP</i>
            <time>7:03 PM</time>
          </div>
          <p>
            Fixed the clock dependency. 20 runs passed. <span className="sl-at">@Ada</span>
          </p>
          <div className="sl-unfurl">
            <div className="u-src">
              <Logo src="/github-mark-white.png" />
              GitHub
            </div>
            <span className="u-title">Fix flaky checkout test #482</span>
            <span className="u-meta">acme/shop, 1 commit, +12 −3</span>
          </div>
          <div className="sl-reacts">
            <span className="sl-react me">
              ✅ <b>2</b>
            </span>
            <span className="sl-react">
              🙌 <b>1</b>
            </span>
          </div>
        </div>
      </div>
      <div className="sl-compose">Reply…</div>
    </div>
  );
}

// ---------- Workspace features ----------

const FEATURES = [
  ["Pause and resume", "Stop paying for compute, keep the workspace, pick up where you left off."],
  [
    "Share a live preview",
    "Expose any port as a private URL, or make it public for webhooks and demos.",
  ],
  [
    "Attach your terminal",
    "Open OpenCode in your local TUI with one command, T3 Code in its desktop app, or Pi in a browser terminal.",
  ],
  [
    "Connect from any device",
    "Same workspace in your browser, your agent's desktop app or your phone.",
  ],
  ["Set keys once", "Model keys are saved once and reused in every workspace, never pasted again."],
  ["Script it", "Create workspaces with the SDK. Manage them with the CLI or the SDK."],
] as const;

export function Features() {
  return (
    <Band>
      <Wrap>
        <SectionHead title="Everything a workspace can do">
          Start one from the dashboard, the CLI or the SDK, or let <code>/cloud</code> make one for
          you.
        </SectionHead>
        <div className={cn(cells, "grid-cols-3 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1")}>
          {FEATURES.map(([t, d]) => (
            <div
              key={t}
              className={cn(
                "relative px-6 pt-6 pb-7 max-[640px]:px-[18px] max-[640px]:py-5",
                DRAW_EDGE,
              )}
            >
              <h3 className={cn(h3, "text-[16.5px]")}>{t}</h3>
              <p className={cellText}>{d}</p>
            </div>
          ))}
        </div>
      </Wrap>
    </Band>
  );
}

// ---------- Closing call to action ----------

export function Cta() {
  return (
    <Band id="start" className="text-center">
      <Wrap>
        <h2 className="mx-auto max-w-[16ch] text-[clamp(2.2rem,5vw,3.8rem)] leading-[1.02] font-display font-medium tracking-[-0.03em] text-balance text-fg">
          Give your agents more computers.
        </h2>
        <SetupCommand location="cta" className="mx-auto mt-8 max-w-[560px]" />
        <CtaButtons />
      </Wrap>
    </Band>
  );
}
