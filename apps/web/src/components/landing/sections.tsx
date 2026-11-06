import Link from "next/link";
import type { Route } from "next";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Band, PartHeading, SectionHead, Wrap } from "@/components/site/section";
import { CodeBlock, InstallCommand } from "@/components/site/code-block";
import { CopyButton } from "@/components/site/copy-button";
import { Mark } from "@/components/site/mark";
import {
  GITHUB_URL,
  INSTALL_CLOUD,
  INSTALL_SANDBOX,
  PLANNED_PROVIDERS,
  SANDBOX_PROVIDERS,
  T3_LOGO,
} from "@/lib/site/providers";
import { SITE_URL } from "@/lib/docs/content";
import { cn } from "@/lib/utils";
import { ReplayButton } from "./demo";
import { SoundToggle } from "./sound-toggle";
import { WorkspacesCard } from "./workspaces-card";
import { Logo } from "./logo";

const h3 = "m-0 mb-2 text-[17px] font-medium text-fg";
const cellText = "text-[15px] leading-[1.6] text-fg-3 [&_code]:text-fg";
/** Hairline grid: cells sit on the page colour with 1px gaps showing the line between them. */
const cells = "grid gap-px border border-line bg-line [&>*]:bg-background";

// ---------- Hero ----------

/** A copyable shell command: one line where it fits, otherwise it breaks at a space. */
function Command({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-fill py-2 pr-1.5 pl-3.5 font-mono text-[12.5px] leading-[1.6] text-fg-2">
      <span className="min-w-0 flex-1">
        <span className="text-fg-4 select-none">$ </span>
        {value.split(" ").map((word, i) => (
          <Fragment key={i}>
            {i > 0 && " "}
            <span className="whitespace-nowrap">{word}</span>
          </Fragment>
        ))}
      </span>
      {/* Icon only; the label stays for screen readers */}
      <CopyButton
        value={value}
        icon
        className="size-8 justify-center bg-transparent px-0 hover:bg-fill-2 [&_[data-label]]:sr-only"
      />
    </div>
  );
}

/**
 * One of the two hero cards. The four parts sit on a shared subgrid, so titles, text, logos and
 * commands line up across both cards whatever their length.
 */
function Lane({
  href,
  title,
  children,
  logos,
  command,
  note,
}: {
  href: string;
  title: string;
  children: ReactNode;
  logos: string[];
  command: string;
  note: ReactNode;
}) {
  return (
    <div className="relative row-span-4 grid grid-rows-subgrid gap-y-0 bg-background px-7 pt-6 pb-7 transition-colors before:absolute before:-inset-x-px before:-top-px before:h-0.5 before:origin-left before:scale-x-0 before:bg-primary before:transition-transform before:duration-[400ms] before:ease-[cubic-bezier(0.22,1,0.36,1)] focus-within:before:scale-x-100 hover:bg-[#131317] hover:before:scale-x-100">
      {/* The title link covers the card; the command and links sit above it. */}
      <Link
        href={href as Route}
        className="mb-2 text-[18px] font-medium tracking-[-0.01em] text-fg after:absolute after:inset-0 focus-visible:outline-none"
      >
        {title}
      </Link>
      <p className="m-0 text-[15px] leading-[1.6] text-fg-3">{children}</p>
      <span className="mt-4 flex items-center gap-2">
        {logos.map((l) => (
          <Logo key={l} src={l} className="size-[18px] object-contain" />
        ))}
      </span>
      <div className="relative z-10 mt-7 flex flex-col gap-3">
        <Command value={command} />
        <p className="m-0 text-[13.5px] leading-[1.55] text-fg-4 [&_a]:text-fg-2 [&_a]:underline [&_a]:decoration-line-2 [&_a]:underline-offset-[3px] hover:[&_a]:text-fg [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-fg-2">
          {note}
        </p>
      </div>
    </div>
  );
}

/**
 * A prompt to paste into a coding agent. It sends the agent to llms.txt instead of spelling out
 * setup steps here, so it stays right as the docs change, and it asks the user before acting.
 */
const SETUP_PROMPT = `Set up Gitterm for me. Read ${SITE_URL}/llms.txt first and follow the docs it links to. Don't guess at commands or config.

Before you change anything, ask me which of these I want:
1. Remote sandboxes for the OpenCode agent on this machine (@gitterm/opencode-sandbox). Ask which provider (E2B, Daytona, Vercel, Boat, exe.dev, Railway or AWS) and whether I'll use my own provider key or a Gitterm plan.
2. Moving an OpenCode session to a cloud workspace with /cloud (@gitterm/opencode-cloud).
3. A cloud workspace that runs OpenCode, or T3 Code with Codex or Claude Code, started from ${SITE_URL}/dashboard.

Both plugins are for OpenCode. If I use a different agent, only option 3 applies.

Keep keys out of config files: use {env:VAR} references. When you're done, show me how to check that it works.`;

export function Hero() {
  return (
    <section className="pt-[clamp(40px,6.5vw,80px)] pb-6 text-center">
      <Wrap>
        <h1 className="mx-auto max-w-[17ch] text-[clamp(2.6rem,6.6vw,5.4rem)] leading-[0.98] font-display font-semibold tracking-[-0.035em] text-balance text-fg">
          Give your agents more room to work.
        </h1>
        <p className="mx-auto mt-6 max-w-[40rem] text-[clamp(16px,1.5vw,18px)] leading-[1.65] text-pretty text-fg-3">
          Cloud sandboxes for the agent on your laptop, or a cloud workspace for the whole agent.
          From the provider you choose, and you can switch any time.
        </p>
        <div className="mx-auto mt-10 grid max-w-[1080px] grid-cols-2 gap-px border border-line-2 bg-line-2 text-left max-[760px]:grid-cols-1">
          <Lane
            href="/#providers"
            title="Extend your laptop"
            logos={["/opencode.svg"]}
            command={INSTALL_SANDBOX}
            note={
              <>
                Then <Link href={"/docs/sandboxes/setup" as Route}>fill in your config</Link>. No
                Gitterm account needed.
              </>
            }
          >
            OpenCode on your laptop runs tests, builds and previews in cloud sandboxes.
          </Lane>
          <Lane
            href="/#agents"
            title="Run agents in the cloud"
            logos={["/opencode.svg", T3_LOGO, "/openai-codex.svg", "/claude.svg"]}
            command={INSTALL_CLOUD}
            note={
              <>
                Then <Link href={"/docs/workspaces/move-a-session" as Route}>sign in</Link> and type{" "}
                <code>/cloud</code>, or <Link href="/dashboard">start one in the browser</Link>.
              </>
            }
          >
            OpenCode, Codex or Claude Code in a cloud workspace. Reach it from your phone or Slack.
          </Lane>
        </div>
        {/* For people who'd rather hand setup to their agent: copy a prompt, no steps to follow */}
        <div className="mx-auto mt-3 flex max-w-[1080px] items-center gap-4 border border-line-2 bg-background px-7 py-3 text-left max-[760px]:px-5">
          <span className="shrink-0 text-[14px] text-fg-2">Or let your agent set it up</span>
          {/* Paste it into any of these. Grey and stacked; hover spreads them out in colour */}
          <span
            className="stack fan shrink-0 max-[480px]:hidden"
            role="img"
            aria-label="OpenCode, T3 Code, Codex or Claude Code"
          >
            {["/opencode.svg", T3_LOGO, "/openai-codex.svg", "/claude.svg"].map((l) => (
              <span key={l}>
                <Logo src={l} />
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg-4 max-[640px]:hidden">
            {SETUP_PROMPT.split("\n")[0]}
          </span>
          <CopyButton value={SETUP_PROMPT} label="Copy prompt" icon className="ml-auto" />
        </div>
      </Wrap>
    </section>
  );
}

// ---------- Providers strip (doubles as the demo's provider picker) ----------

const stripButton =
  "group relative flex flex-col items-center gap-2.5 px-2 pt-[22px] pb-5 text-[15px] leading-[1.2] font-medium text-fg-3 transition-colors duration-[350ms] focus-visible:-outline-offset-[3px] max-[860px]:nth-[-n+4]:border-b max-[860px]:nth-[-n+4]:border-line max-[420px]:px-1 max-[420px]:pt-[18px] max-[420px]:pb-4 max-[420px]:text-[13.5px]";
/** Grey until hovered or picked, so exe.dev's photo and AWS's orange tile don't outshout the rest. */
const stripLogo =
  "size-7 object-contain grayscale transition-[opacity,transform,filter] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] max-[420px]:size-6";

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
                  "opacity-60 group-hover:opacity-90 group-hover:grayscale-0 group-aria-pressed:-translate-y-0.5 group-aria-pressed:opacity-100 group-aria-pressed:grayscale-0",
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
    body: "Add the plugin and OpenCode gets sandbox tools. The conversation and your model keys stay on your machine.",
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
        Add the cloud plugin and type <code>/cloud</code>. The conversation, your unpublished
        commits and, if you choose, uncommitted changes move to a cloud workspace. Pick it up from
        your phone, a browser or OpenCode desktop. Your laptop copy stays as it was.
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
                    <b>Build</b> · <span>Claude Opus 5.5</span> Anthropic
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
              Open the workspace&apos;s pairing link on your phone, your laptop or any browser.
              Pause it when you are done and pick up later.
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
    "Open it in your local OpenCode TUI with one command, or in the T3 Code desktop app.",
  ],
  ["Connect from any device", "Same workspace in your browser, OpenCode desktop or your phone."],
  ["Set keys once", "Model and environment keys are reused across workspaces, never pasted again."],
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
          Give your agents more computers.
        </h2>
        <p className="mx-auto mt-[18px] max-w-[34rem] text-fg-3">
          Add the plugin to OpenCode, or start a cloud workspace. Open source and self-hostable.
        </p>
        <InstallCommand command={INSTALL_SANDBOX} className="mt-[18px]" />
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
