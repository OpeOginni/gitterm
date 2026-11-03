import Link from "next/link";
import type { Route } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Band, PartHeading, SectionHead, Wrap } from "@/components/site/section";
import { CodeBlock, InstallCommand } from "@/components/site/code-block";
import {
  GITHUB_URL,
  INSTALL_SANDBOX_TOOLS,
  PLANNED_PROVIDERS,
  SANDBOX_PROVIDERS,
  T3_LOGO,
} from "@/lib/site/providers";
import { cn } from "@/lib/utils";
import { ReplayButton } from "./demo";
import { Logo } from "./logo";

const h3 = "m-0 mb-2 text-[17px] font-medium text-fg";
const cellText = "text-[15px] leading-[1.6] text-fg-3 [&_code]:text-fg";
/** Hairline grid: cells sit on the page colour with 1px gaps showing the line between them. */
const cells = "grid gap-px border border-line bg-line [&>*]:bg-background";

// ---------- Hero ----------

function Lane({
  href,
  title,
  children,
  logos,
  note,
}: {
  href: string;
  title: string;
  children: ReactNode;
  logos: string[];
  note: string;
}) {
  return (
    <Link
      href={href as Route}
      className="relative flex flex-col gap-2 bg-background px-6 pt-[22px] pb-5 transition-colors before:absolute before:-inset-x-px before:-top-px before:h-0.5 before:origin-left before:scale-x-0 before:bg-primary before:transition-transform before:duration-[400ms] before:ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#131317] hover:before:scale-x-100 focus-visible:before:scale-x-100"
    >
      <span className="text-[18px] font-medium tracking-[-0.01em] text-fg">{title}</span>
      <span className="text-[15px] leading-[1.55] text-fg-3">{children}</span>
      <span className="mt-auto flex items-center gap-2 pt-2 text-[13.5px] text-fg-4">
        {logos.map((l) => (
          <Logo key={l} src={l} className="size-[18px] object-contain last-of-type:mr-1" />
        ))}
        {note}
      </span>
    </Link>
  );
}

export function Hero() {
  return (
    <section className="pt-[clamp(40px,6.5vw,80px)] pb-6 text-center">
      <Wrap>
        <h1 className="mx-auto max-w-[17ch] text-[clamp(2.6rem,6.6vw,5.4rem)] leading-[0.98] font-display font-semibold tracking-[-0.035em] text-balance text-fg">
          Give your agents more computers.
        </h1>
        <p className="mx-auto mt-6 max-w-[40rem] text-[clamp(16px,1.5vw,18px)] leading-[1.65] text-pretty text-fg-3">
          Attach cloud sandboxes to the agent on your laptop, or run the whole agent in a cloud
          workspace that keeps going when you close the lid.
        </p>
        <div className="mx-auto mt-10 grid max-w-[900px] grid-cols-2 gap-px border border-line-2 bg-line-2 text-left max-[700px]:grid-cols-1">
          <Lane
            href="/#providers"
            title="Extend your laptop"
            logos={["/opencode.svg"]}
            note="OpenCode plugin"
          >
            Your local OpenCode session runs tests, builds and previews in sandboxes it attaches on
            demand.
          </Lane>
          <Lane
            href="/#agents"
            title="Run agents in the cloud"
            logos={["/opencode.svg", T3_LOGO, "/openai-codex.svg", "/claude.svg"]}
            note="Cloud workspaces"
          >
            A workspace for OpenCode or T3 Code with Codex and Claude Code. Reach it from your
            phone, Slack or your own code.
          </Lane>
        </div>
      </Wrap>
    </section>
  );
}

// ---------- Providers strip (doubles as the demo's provider picker) ----------

const stripButton =
  "group relative flex flex-col items-center gap-2.5 px-2 pt-[22px] pb-5 text-[15px] leading-[1.2] font-medium text-fg-3 transition-colors duration-[350ms] focus-visible:-outline-offset-[3px] max-[860px]:nth-[-n+4]:border-b max-[860px]:nth-[-n+4]:border-line max-[420px]:px-1 max-[420px]:pt-[18px] max-[420px]:pb-4 max-[420px]:text-[13.5px]";
const stripLogo =
  "size-7 object-contain transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] max-[420px]:size-6";

export function ProvidersStrip() {
  return (
    <section
      id="providers"
      aria-labelledby="prov-h"
      className="mt-[clamp(56px,7vw,88px)] scroll-mt-20 text-center"
    >
      <Wrap>
        <PartHeading className="mb-2.5">Extend your laptop</PartHeading>
        <p id="prov-h" className="mx-auto mb-[26px] max-w-[40rem] text-[15px] text-fg-3">
          Your agent can attach sandboxes from any of these. The demo moves through them on its own,
          or pick one to see it.
        </p>
        <div
          data-prov-strip
          role="group"
          aria-label="Sandbox providers"
          className="grid grid-cols-8 border-y border-line max-[860px]:grid-cols-4"
        >
          {SANDBOX_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-prov={p.id}
              aria-pressed={p.id === "e2b"}
              className={cn(
                stripButton,
                "cursor-pointer after:absolute after:inset-x-[22%] after:-bottom-px after:h-0.5 after:scale-x-0 after:rounded-sm after:bg-primary after:transition-transform after:duration-500 after:ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.025] hover:text-fg aria-pressed:text-fg aria-pressed:after:scale-x-100",
              )}
            >
              <Logo
                src={p.logo}
                className={cn(
                  stripLogo,
                  "opacity-60 group-hover:opacity-90 group-aria-pressed:-translate-y-0.5 group-aria-pressed:opacity-100",
                )}
              />
              {p.name}
            </button>
          ))}
          {PLANNED_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-disabled
              title="Sandboxes on Cloudflare are planned. Cloud workspaces run there today."
              className={cn(stripButton, "cursor-default text-fg-4")}
            >
              <Logo src={p.logo} className={cn(stripLogo, "opacity-35")} />
              {p.name}
              <small className="-mt-1 text-[12.5px] font-normal text-fg-4">Soon</small>
            </button>
          ))}
        </div>
      </Wrap>
    </section>
  );
}

// ---------- What the plugin does: chapters beside a sticky TUI ----------

const CHAPTERS: { title: string; body: ReactNode; used?: string[]; id?: string }[] = [
  {
    title: "Your agent stays on your laptop",
    body: "Add the plugin and OpenCode gets sandbox tools. The conversation, your files and your model keys never leave your machine.",
  },
  {
    title: "It borrows a machine when it needs one",
    body: (
      <>
        The agent starts a sandbox on the provider you set and syncs your working tree. Ignored
        files like <code>.env</code> stay home.
      </>
    ),
    used: ["sandbox_create", "sandbox_sync"],
  },
  {
    title: "The heavy work runs there",
    body: "Tests, builds and dev servers run in the sandbox. Output streams back into the chat while your laptop stays idle.",
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
        Add the cloud handoff plugin and type <code>/cloud</code>. The conversation, your
        unpublished commits and, if you choose, uncommitted changes move to a cloud workspace. Pick
        it up from your phone, a browser or OpenCode desktop. Your laptop copy stays as it was.
      </>
    ),
  },
];

export function HowItWorks() {
  return (
    <Band id="how">
      <Wrap wide>
        <SectionHead title="What the plugin does">
          The same session as above, one step at a time.
        </SectionHead>
        <div className="story">
          <div className="chaps">
            {CHAPTERS.map((c, i) => (
              <article key={c.title} className="chap" data-scene={i} id={c.id}>
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
              <div className="tui" aria-hidden>
                <div className="tui-chrome">
                  <span className="lights">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="title">opencode · ~/code/shop</span>
                </div>
                <div className="scenes" id="scenes" />
                <div className="t-prompt">
                  <div className="t-input">
                    <span className="t-caret" />
                  </div>
                  <div className="t-meta">
                    <b>Build</b> · <span>Claude Sonnet 5.5</span> Anthropic
                  </div>
                </div>
                <div className="t-hints">
                  <span className="path">~/code/shop:checkout-coupons</span>
                  <span>
                    <kbd>shift+tab</kbd> agents&nbsp;&nbsp;&nbsp;<kbd>ctrl+p</kbd> commands
                  </span>
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

const DIRECT = `"options": {
  "account": "e2b",
  "accounts": {
    "e2b": {
      "mode": "direct",
      "provider": "e2b",
      "apiKey": "{env:E2B_API_KEY}"
    }
  },
  "limits": { "maxSandboxes": 2, "maxLifetimeMinutes": 60 }
}`;
const MANAGED = `"options": {
  "account": "gitterm",
  "accounts": {
    "gitterm": { "mode": "managed" }
  },
  "limits": { "maxSandboxes": 2, "maxLifetimeMinutes": 60 }
}`;

export function Keys() {
  return (
    <Band>
      <Wrap>
        <SectionHead title="Your key, or our plan">
          Set an account in the plugin options. Limits apply either way, so a busy agent cannot run
          up a surprise bill.
        </SectionHead>
        <div className={cn(cells, "grid-cols-2 max-[860px]:grid-cols-1")}>
          {[
            {
              title: "Bring your own provider key",
              body: "No Gitterm account needed. The key comes from your environment and the provider bills you directly.",
              code: DIRECT,
            },
            {
              title: "Use your Gitterm plan",
              body: "Sandboxes run on Gitterm's accounts and count against your plan. Gitterm stops anything that outlives its deadline.",
              code: MANAGED,
            },
          ].map((k) => (
            <div
              key={k.title}
              className="min-w-0 px-6 py-[26px] max-[640px]:px-[18px] max-[640px]:py-5"
            >
              <h3 className={cn(h3, "mb-1.5")}>{k.title}</h3>
              <p className={cn(cellText, "mb-[18px]")}>{k.body}</p>
              <CodeBlock
                code={k.code}
                lang="json"
                copy
                className="max-[640px]:[&_pre]:text-[12px] max-[640px]:[&_pre]:[overflow-wrap:anywhere] max-[640px]:[&_pre]:whitespace-pre-wrap"
              />
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
                  <span id="desk-loc">E2B workspace</span>&nbsp;· gitterm/checkout-coupons
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
                      <span className="faint model-provider">Anthropic /&nbsp;</span>Claude Sonnet
                      5.5 <Chevron />
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
        <SectionHead title="Send sessions to the cloud. Keep working.">
          Move an OpenCode session to a cloud workspace with <code>/cloud</code>, or start Codex or
          Claude Code in a new one from T3 Code. They keep running on their own, and your laptop is
          free for whatever is next.
        </SectionHead>
        {/* Two clients. Codex and Claude Code sit under T3 Code, because T3 Code is what runs them. */}
        <div className="-mt-[18px] mb-[26px] flex flex-wrap items-start gap-x-10 gap-y-4">
          <span className="text-[15px] leading-7 text-fg-3 max-sm:basis-full max-sm:-mb-2">
            Works with
          </span>
          <WorksWith logo="/opencode.svg" name="OpenCode">
            Move a session with <code className="font-mono text-[0.95em] text-fg-2">/cloud</code>
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
                      <Logo key={l} src={l} />
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
        <div className="mt-[18px] flex justify-end">
          <ReplayButton id="ho-replay" />
        </div>
      </Wrap>
    </Band>
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
              Open T3 Code or OpenCode at the workspace URL. Pause it when you are done and pick up
              later.
            </p>
            <div className="mini-url">
              <i />
              <i />
              <i />
              <span>ws-7k2.gitterm.dev</span>
            </div>
            <div className="mini-thread">
              <div className="mt-row">
                <b className="dot done" />
                Fix the flaky checkout test<span>Done</span>
              </div>
              <div className="mt-row">
                <b className="dot work" />
                Upgrade to Bun 1.3.14<span>Working 4m</span>
              </div>
              <div className="mt-row">
                <b className="dot wait" />
                Review PR #479<span>Approval</span>
              </div>
            </div>
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
const Bot = () => <span className="sl-av bot">+</span>;

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
    "Open it in your local OpenCode TUI with one command, or in the T3 Code desktop app.",
  ],
  ["Connect from any device", "Same workspace in your browser, OpenCode desktop or your phone."],
  ["Set keys once", "Model and environment keys are reused across workspaces, never pasted again."],
  ["Script it", "Create and manage workspaces with the CLI or the SDK."],
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
            <div key={t} className="px-6 pt-6 pb-7 max-[640px]:px-[18px] max-[640px]:py-5">
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
          Give your agent room to work.
        </h2>
        <p className="mx-auto mt-[18px] max-w-[34rem] text-fg-3">
          Add the plugin to OpenCode, or start a cloud workspace. Open source and self-hostable.
        </p>
        <InstallCommand
          command={INSTALL_SANDBOX_TOOLS}
          className="mt-[18px] max-[640px]:[&>span]:whitespace-normal max-[640px]:[&>span]:[overflow-wrap:anywhere]"
        />
        <div className="mt-8 flex flex-wrap justify-center gap-3">
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
      </Wrap>
    </Band>
  );
}
