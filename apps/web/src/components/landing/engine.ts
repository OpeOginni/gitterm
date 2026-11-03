/**
 * The landing page's demos, driven imperatively.
 *
 * The scripted session streams dozens of lines with grow-in animations, floating windows track the
 * pointer and the page scroll, and the provider row swaps names in place mid-run. Doing that through
 * React state would re-render the whole transcript on every frame, so the markup is server-rendered
 * once and this module mutates it. Everything is looked up inside `root`, and `startLanding` returns
 * a cleanup that clears every timer, observer and listener.
 */
import {
  SANDBOX_PROVIDERS,
  type SandboxProvider,
  type SandboxProviderId,
} from "@/lib/site/providers";

export type DemoMode = "with" | "without";
/** Fired on the landing root by the mode switch. */
export const MODE_EVENT = "lp:mode";

type Slot = "laptop" | "sandbox" | "preview" | "cloud";
type Laptop = {
  bat?: [number, string];
  cpu: number;
  mem: number;
  hot?: boolean;
  ok?: boolean;
  status: string;
  procs: [string, string][];
};
type Step = {
  user?: string;
  text?: string;
  foot?: string;
  laptop?: Laptop;
  tool?: "shell" | "read" | "edit" | "plugin" | "cloud";
  cmd?: string;
  out?: string[];
  dur?: number;
  sub?: string;
  name?: string;
  args?: string;
  argsHtml?: string;
  res?: string;
  resHtml?: string;
  attach?: Slot;
  term?: string[];
  stream?: boolean;
  lines?: [string, string][];
};
type Script = { empty: Record<Exclude<Slot, "laptop">, string>; steps: Step[] };

const PROVIDERS = Object.fromEntries(SANDBOX_PROVIDERS.map((p) => [p.id, p])) as Record<
  SandboxProviderId,
  SandboxProvider
>;
const ORDER = SANDBOX_PROVIDERS.map((p) => p.id);

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const md = (s: string) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const color = (line: string) => {
  const e = esc(line);
  if (line.startsWith("$ ")) return `<span class="c">${e}</span>`;
  if (
    /^\s*pass\b/.test(line) ||
    (/passed \(/.test(line) && !/failed/.test(line)) ||
    /^Ready|ready in|synced|^✔/.test(line.trim())
  )
    return `<span class="p">${e}</span>`;
  if (/fail|expected 400/.test(line)) return `<span class="f">${e}</span>`;
  return e;
};
const acctOf = (P: SandboxProvider) => (P.byoKey ? `your ${P.name} key` : "your Gitterm plan");

const TESTS = [
  "$ bun test",
  " pass  src/cart/price.test.ts (12 tests) 41ms",
  " pass  src/cart/discount.test.ts (8 tests) 22ms",
  " pass  src/api/orders.test.ts (19 tests) 380ms",
  " fail  src/api/checkout.test.ts > rejects expired coupons",
  "       expected 400, received 200",
  " pass  src/ui/Cart.test.tsx (14 tests) 612ms",
];
const DIFF: [string, string, string][] = [
  ["cx", "41", "  const coupon = await findCoupon(code)"],
  ["rm", "42", "- if (coupon.code) applyDiscount(cart, coupon)"],
  ["ad", "42", '+ if (coupon.expiresAt < now()) throw badRequest("Coupon expired")'],
  ["ad", "43", "+ applyDiscount(cart, coupon)"],
  ["cx", "44", "  return ok(cart)"],
];
const ASK = "Run the full test suite and give me a preview of the checkout page.";
const TRAIN = "I have to leave for a train. Keep going and I'll check from my phone.";
const PREVIEW_URL = "https://3000-sbx7f3a2c.preview.gitterm.dev/checkout";

const WITHOUT: Script = {
  empty: {
    sandbox: "Tests and Postgres run on your laptop instead.",
    preview: "localhost:3000 only opens on this machine.",
    cloud: "Closing the lid ends the session.",
  },
  steps: [
    { user: ASK },
    {
      laptop: {
        bat: [91, "6h 40m"],
        cpu: 18,
        mem: 6.1,
        status: "OpenCode is working.",
        procs: [["opencode", "working"]],
      },
    },
    { text: "I'll start Postgres locally and run the suite." },
    {
      tool: "shell",
      cmd: "docker compose up -d postgres",
      out: ["✔ Container shop-postgres-1  Started"],
      dur: 1600,
      laptop: {
        bat: [88, "4h 10m"],
        cpu: 46,
        mem: 9.6,
        status: "Postgres is running in Docker.",
        procs: [
          ["opencode", "working"],
          ["docker: postgres", "1.9 GB"],
        ],
      },
    },
    {
      tool: "shell",
      cmd: "bun test",
      out: [...TESTS.slice(1), " 1 failed, 52 passed (53 tests) in 4m 12s"],
      dur: 4200,
      laptop: {
        bat: [81, "1h 05m"],
        cpu: 94,
        mem: 13.9,
        hot: true,
        status: "Fans on. The whole suite runs here.",
        procs: [
          ["opencode", "working"],
          ["docker: postgres", "2.4 GB"],
          ["bun test", "7 threads"],
        ],
      },
    },
    {
      laptop: {
        bat: [78, "1h 50m"],
        cpu: 38,
        mem: 10.2,
        status: "Postgres is still running.",
        procs: [
          ["opencode", "working"],
          ["docker: postgres", "2.4 GB"],
        ],
      },
    },
    {
      text: "One failure: expired coupons are still accepted. Fixing it in `src/api/checkout.ts`.",
    },
    { tool: "read", sub: "src/api/checkout.ts:30-48" },
    { tool: "edit", dur: 900 },
    {
      tool: "shell",
      cmd: "bun test src/api/checkout.test.ts",
      out: [" pass  src/api/checkout.test.ts (9 tests) 204ms"],
      dur: 1500,
      laptop: {
        bat: [74, "1h 20m"],
        cpu: 71,
        mem: 11.0,
        hot: true,
        status: "Running tests locally.",
        procs: [
          ["opencode", "working"],
          ["docker: postgres", "2.4 GB"],
          ["bun test", "running"],
        ],
      },
    },
    {
      tool: "shell",
      cmd: "bun run dev",
      out: ["Ready on http://localhost:3000"],
      dur: 1300,
      laptop: {
        bat: [71, "1h 35m"],
        cpu: 52,
        mem: 12.4,
        status: "Dev server on localhost:3000.",
        procs: [
          ["opencode", "working"],
          ["docker: postgres", "2.4 GB"],
          ["bun run dev", ":3000"],
        ],
      },
    },
    {
      text: "Tests pass. The checkout page runs at `localhost:3000`, which only this machine can open.",
    },
    { foot: "6m 31s" },
    { user: TRAIN },
    {
      text: "I can't come with you. This session runs on your laptop, so closing the lid stops the dev server, Postgres and me with it.",
      laptop: {
        bat: [68, "1h 40m"],
        cpu: 41,
        mem: 12.4,
        hot: true,
        status: "Closing the lid ends the session.",
        procs: [
          ["opencode", "idle"],
          ["docker: postgres", "2.4 GB"],
          ["bun run dev", ":3000"],
        ],
      },
    },
    { foot: "4.1s" },
  ],
};

function withSteps(P: SandboxProvider, id: SandboxProviderId): Script {
  return {
    empty: {
      sandbox: "Attaches when the agent calls sandbox_create.",
      preview: "Attaches when the agent calls sandbox_preview.",
      cloud: "Attaches when you type /cloud.",
    },
    steps: [
      { user: ASK },
      {
        laptop: {
          bat: [92, "6h 50m"],
          cpu: 12,
          mem: 5.2,
          status: "OpenCode is working.",
          procs: [["opencode", "working"]],
        },
      },
      { text: "I'll run this in a sandbox so nothing heavy runs on your laptop." },
      {
        tool: "plugin",
        name: "sandbox_create",
        argsHtml: `provider="<span data-pid>${id}</span>" template="node-22" lifetime=60`,
        resHtml: `sbx_7f3a2c ready in 1.8s, <span data-pacct>${esc(acctOf(P))}</span>`,
        dur: 1500,
        attach: "sandbox",
        term: ["sbx_7f3a2c ready in 1.8s"],
      },
      {
        tool: "plugin",
        name: "sandbox_sync",
        args: `from="~/code/shop"`,
        res: "1,284 files, 18.2 MB, .gitignore respected",
        dur: 1300,
        term: ["synced 1,284 files (18.2 MB), .gitignore respected"],
      },
      {
        tool: "plugin",
        name: "sandbox_exec",
        args: `command="bun test"`,
        resHtml:
          '<span class="ok">52 pass</span>  <span class="bad">1 fail</span>  53 tests in 38s',
        dur: 3200,
        term: [...TESTS, " 1 failed, 52 passed (53 tests)"],
        stream: true,
      },
      {
        text: "One failure: expired coupons are still accepted. Fixing it in your local checkout.",
      },
      { tool: "read", sub: "src/api/checkout.ts:30-48" },
      {
        tool: "edit",
        dur: 900,
        laptop: {
          bat: [91, "7h"],
          cpu: 8,
          mem: 5.3,
          ok: true,
          status: "Editing one file. Nothing heavy runs here.",
          procs: [["opencode", "working"]],
        },
      },
      {
        tool: "plugin",
        name: "sandbox_sync",
        args: `paths="src/api/checkout.ts"`,
        res: "1 file synced",
        dur: 800,
        term: ["synced 1 file"],
      },
      {
        tool: "plugin",
        name: "sandbox_exec",
        args: `command="bun test src/api/checkout.test.ts"`,
        resHtml: '<span class="ok">9 pass</span>  0 fail',
        dur: 1400,
        term: [
          "$ bun test src/api/checkout.test.ts",
          " pass  src/api/checkout.test.ts (9 tests) 204ms",
          " 53 passed (53 tests)",
        ],
        stream: true,
      },
      {
        tool: "plugin",
        name: "sandbox_job",
        args: `command="bun run dev" port=3000`,
        res: "job_2 running, listening on :3000",
        dur: 1200,
        term: ["$ bun run dev   job_2, background", "Ready on http://0.0.0.0:3000"],
      },
      {
        tool: "plugin",
        name: "sandbox_preview",
        args: "port=3000",
        resHtml: `<span class="url">${PREVIEW_URL}</span> <span data-ppub>${P.publicPreviews ? "public" : "private"}</span>`,
        dur: 1200,
        attach: "preview",
      },
      {
        tool: "plugin",
        name: "sandbox_apply",
        args: `paths="src/ui/__snapshots__/Cart.test.tsx.snap"`,
        res: "1 file applied to your checkout",
        dur: 900,
      },
      {
        text: "Tests pass and the checkout preview is up. I applied the updated snapshot to your checkout, so review it with `git diff`.",
      },
      { foot: "1m 12s" },
      { user: TRAIN },
      { user: "/cloud" },
      {
        tool: "cloud",
        dur: 2400,
        attach: "cloud",
        lines: [
          ["Conversation", "41 messages"],
          ["Unpublished commits", "2 on checkout-coupons"],
          ["Uncommitted changes", "3 files, approved"],
          ["Snapshot", "6.4 MB of 25 MiB"],
        ],
        laptop: {
          bat: [91, "7h 20m"],
          cpu: 4,
          mem: 4.9,
          ok: true,
          status: "Safe to close the lid.",
          procs: [["opencode", "idle"]],
        },
      },
      {
        text: "This session now continues in a cloud workspace on {P}, on `gitterm/checkout-coupons`. Open the pairing link on your phone. Your laptop copy is unchanged.",
      },
      { foot: "6.8s" },
    ],
  };
}

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

const ICON = {
  shell:
    '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="m4.5 6.5 2 1.5-2 1.5M8 10h3.5"/></svg>',
  edit: '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/></svg>',
  read: '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="4.5" cy="9.5" r="2.5"/><circle cx="11.5" cy="9.5" r="2.5"/><path d="M7 9.5h2M2 9.5 3 5M14 9.5 13 5"/></svg>',
  plugin:
    '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M6 1.5v3M10 1.5v3M4 4.5h8v3a4 4 0 0 1-8 0v-3ZM8 11.5v3"/></svg>',
  cloud:
    '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4.5 12.5a3 3 0 0 1-.3-6 4 4 0 0 1 7.7.9 2.6 2.6 0 0 1-.4 5.1h-7Z"/></svg>',
};
const CHEV =
  '<svg class="chev" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="m5 3 4 4-4 4"/></svg>';
const ocRow = (icon: keyof typeof ICON, title: string, sub: string, body = "", open = false) =>
  `<details class="oc-tool"${open ? " open" : ""}><summary>${ICON[icon]}<span class="t">${title}</span><span class="s">${esc(sub)}</span>${CHEV}</summary>${body}</details>`;

function scenesFor(P: SandboxProvider, id: SandboxProviderId) {
  const tool = (name: string, args: string, res: string, first = false) =>
    `<div class="t-inline${first ? " first" : ""}"><span>✓</span><span class="args"><span class="n">${name}</span> ${esc(args)}</span><span class="res">${res}</span></div>`;
  const user = (t: string) => `<div class="t-user">${esc(t)}</div>`;
  const text = (t: string) => `<p class="t-text">${md(t)}</p>`;
  return [
    user(ASK) + text("I'll run this in a sandbox so nothing heavy runs on your laptop."),
    tool(
      "sandbox_create",
      `provider="${id}" template="node-22" lifetime=60`,
      esc(`sbx_7f3a2c ready in 1.8s, ${acctOf(P)}`),
      true,
    ) + tool("sandbox_sync", `from="~/code/shop"`, "1,284 files, 18.2 MB, .gitignore respected"),
    tool(
      "sandbox_exec",
      `command="bun test"`,
      '<span class="ok">52 pass</span>  <span class="bad">1 fail</span>  53 tests in 38s',
      true,
    ) +
      text("One failure: expired coupons are still accepted. Fixing it in your local checkout.") +
      tool(
        "sandbox_exec",
        `command="bun test src/api/checkout.test.ts"`,
        '<span class="ok">9 pass</span>  0 fail',
        true,
      ) +
      tool("sandbox_job", `command="bun run dev" port=3000`, "job_2 running, listening on :3000"),
    tool(
      "sandbox_preview",
      "port=3000",
      `<span class="url">${PREVIEW_URL}</span> ${P.publicPreviews ? "public" : "private"}`,
      true,
    ) +
      tool(
        "sandbox_apply",
        `paths="src/ui/__snapshots__/Cart.test.tsx.snap"`,
        "1 file applied to your checkout",
      ) +
      text("Tests pass and the checkout preview is up. Review the snapshot with `git diff`."),
    user(TRAIN) +
      user("/cloud") +
      `<div class="t-block"><div class="hd"># Cloud handoff</div><div class="o">Conversation         <span style="color:var(--t-text)">41 messages</span>\nUnpublished commits  <span style="color:var(--t-text)">2 on checkout-coupons</span>\nUncommitted changes  <span style="color:var(--t-text)">3 files, approved</span>\n\n<span class="hl">→ ${esc(P.name)} workspace ready on gitterm/checkout-coupons</span>\nPair your phone      <span class="url">gitterm.dev/pair/7QK-4M2</span></div></div>` +
      text(
        `This session now continues in a cloud workspace on ${P.name}. Your laptop copy is unchanged.`,
      ),
  ];
}

// Part 2. Truthful to what ships: OpenCode sessions move with /cloud (one way).
// Codex and Claude Code don't move; T3 Code starts them in a new cloud workspace.
type Sess = {
  id: string;
  logo: string;
  agent: string;
  title: string;
  t3?: boolean;
  prov?: [string, string];
  work?: string;
  done?: string;
};
const SESS: Sess[] = [
  {
    id: "oc",
    logo: "/opencode.svg",
    agent: "OpenCode",
    title: "Fix the flaky checkout test",
    prov: ["E2B", "/E2B.svg"],
    work: "Running the test 20 times",
    done: "20 runs green. Opened PR #482.",
  },
  {
    id: "o2",
    logo: "/opencode.svg",
    agent: "OpenCode",
    title: "Add coupon expiry to the admin",
    prov: ["Vercel", "/vercel.svg"],
    work: "Building the admin form",
    done: "Form and tests done. Opened PR #483.",
  },
];
const FRESH: Sess[] = [
  {
    id: "cx",
    logo: "/openai-codex.svg",
    agent: "Codex in T3 Code",
    t3: true,
    title: "Upgrade to Bun 1.3.14",
    prov: ["Daytona", "/daytona.svg"],
    work: "Updating the lockfile and CI",
    done: "All 53 tests pass. Opened PR #484.",
  },
  {
    id: "cc",
    logo: "/claude.svg",
    agent: "Claude Code in T3 Code",
    t3: true,
    title: "Review PR #479",
    prov: ["Railway", "/railway.svg"],
    work: "Reading 14 changed files",
    done: "Review posted with 3 comments.",
  },
];

export function startLanding(root: HTMLElement): () => void {
  const ac = new AbortController();
  const on = { signal: ac.signal } as const;
  const passive = { signal: ac.signal, passive: true } as const;
  const timeouts = new Set<number>();
  const intervals: number[] = [];
  const observers: { disconnect(): void }[] = [];
  let raf = 0;

  // setTimeout that is cleared on dispose
  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timeouts.delete(t);
      fn();
    }, ms);
    timeouts.add(t);
    return t;
  };
  const cancel = (t: number) => {
    clearTimeout(t);
    timeouts.delete(t);
  };
  const observe = <T extends { disconnect(): void }>(o: T) => {
    observers.push(o);
    return o;
  };

  const need = <T extends Element = HTMLElement>(sel: string, from: ParentNode = root): T => {
    const el = from.querySelector<T>(sel);
    if (!el) throw new Error(`landing: missing ${sel}`);
    return el;
  };
  const $ = (id: string) => need<HTMLElement>(`#${id}`);
  const all = <T extends Element = HTMLElement>(sel: string, from: ParentNode = root) => [
    ...from.querySelectorAll<T>(sel),
  ];

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const transcript = $("transcript");
  const scroll = $("scroll");
  const input = $("input");
  const hints = $("hints");
  const term = $("term");
  const stage = $("bench");
  const benchNote = $("benchnote");
  const sbar = need(".sbar", stage);
  const slots = Object.fromEntries(all(".slot", stage).map((s) => [s.dataset.slot, s])) as Record<
    Slot,
    HTMLElement
  >;
  const items = Object.fromEntries(all(".si", stage).map((b) => [b.dataset.for, b])) as Record<
    Slot,
    HTMLElement
  >;
  const wins = Object.fromEntries(
    all(".fw[data-win]", stage).map((w) => [w.dataset.win, w]),
  ) as Record<Slot, HTMLElement>;
  const alerts = Object.fromEntries(
    all(".fw[data-alert]", stage).map((w) => [w.dataset.alert, w]),
  ) as Record<Slot, HTMLElement>;
  const strip = need("[data-prov-strip]");

  let prov: SandboxProviderId = "e2b";
  let mode: DemoMode = "with";
  let run = 0;

  // ---------- TUI rendering (the live demo) ----------
  let spinI = 0;
  if (!reduce)
    intervals.push(
      window.setInterval(() => {
        spinI = (spinI + 1) % SPIN.length;
        for (const n of all(".spin-t")) n.textContent = SPIN[spinI] ?? "";
      }, 90),
    );

  const wait = (ms: number, id: number) =>
    reduce
      ? Promise.resolve(id === run)
      : new Promise<boolean>((r) => later(() => r(id === run), ms));

  // Keep the transcript pinned to its newest line every frame. Content grows in gradually, so pinning
  // each frame reads as a smooth scroll, never a jump. After a run the reader scrolls freely.
  const pin = () => {
    if (!scroll.classList.contains("free")) scroll.scrollTop = scroll.scrollHeight;
    raf = requestAnimationFrame(pin);
  };
  raf = requestAnimationFrame(pin);

  // New content grows from zero height instead of appearing at full size. (`lp-grow`, not
  // `grow`: that one is a Tailwind utility and would win over landing.css.)
  function grow(html: string, cls = "") {
    const el = document.createElement("div");
    el.className = `lp-grow ${cls}`;
    el.innerHTML = `<div class="gi">${html}</div>`;
    return el;
  }
  function reveal(el: HTMLElement) {
    if (!reduce) void el.offsetHeight;
    el.classList.add("in");
  }
  function addLine(container: HTMLElement, html: string, cls?: string) {
    const el = grow(html, cls);
    container.appendChild(el);
    reveal(el);
    return el;
  }

  function setHints(busy: boolean) {
    hints.innerHTML = busy
      ? `<span class="path">~/code/shop:checkout-coupons</span><span class="busy"><span class="spin-t">${SPIN[0]}</span> <kbd>esc</kbd> <span style="color:var(--t-muted)">interrupt</span></span>`
      : `<span class="path">~/code/shop:checkout-coupons</span><span><kbd>shift+tab</kbd> agents&nbsp;&nbsp;&nbsp;<kbd>ctrl+p</kbd> commands</span>`;
  }

  function setLaptop(l?: Laptop) {
    if (!l) return;
    $("cpu").textContent = `${l.cpu}%`;
    $("cpubar").style.width = `${l.cpu}%`;
    $("cpubar").classList.toggle("hot", l.cpu >= 70);
    $("mem").textContent = `${l.mem.toFixed(1)} of 16 GB`;
    $("membar").style.width = `${Math.round((l.mem / 16) * 100)}%`;
    $("membar").classList.toggle("hot", l.mem >= 12);
    const st = $("status");
    st.textContent = l.status;
    st.className = `status${l.hot ? " hot" : l.ok ? " ok" : ""}`;
    if (l.bat) {
      $("bat").textContent = `${l.bat[0]}%, ${l.bat[1]} left`;
      $("batbar").style.width = `${l.bat[0]}%`;
      $("batbar").classList.toggle("hot", l.bat[0] < 70);
    }
    $("procs").innerHTML = l.procs
      .map(([n, v]) => `<li>${esc(n)}<span>${esc(v)}</span></li>`)
      .join("");
    laptopStatus(l);
  }

  let lastKind = "";
  function addEl(html: string, kind = "") {
    const w = grow(html.trim());
    const el = w.firstElementChild?.firstElementChild as HTMLElement;
    if (kind === "inline" && lastKind !== "inline") el.classList.add("first");
    lastKind = kind;
    transcript.appendChild(w);
    reveal(w);
    return el;
  }

  async function typeUser(text: string, id: number) {
    if (!reduce) {
      const step = text.length > 30 ? 18 : 60;
      for (let i = 1; i <= text.length; i++) {
        input.innerHTML = `${esc(text.slice(0, i))}<span class="t-caret"></span>`;
        if (!(await wait(step, id))) return false;
      }
      if (!(await wait(350, id))) return false;
    }
    input.innerHTML = '<span class="t-caret"></span>';
    return true;
  }

  async function streamTerm(lines: string[], id: number, stream: boolean) {
    for (const line of lines) {
      addLine(term, color(line));
      while (term.children.length > 40) term.firstElementChild?.remove();
      if (stream && !(await wait(260, id))) return false;
    }
    return true;
  }

  const diffHtml = () =>
    `<div class="t-diff">${DIFF.map(([c, n, l]) => `<div class="${c}"><span class="ln">${n}</span>${esc(l)}</div>`).join("")}</div>`;

  async function play(m: DemoMode) {
    const id = ++run;
    mode = m;
    const P = PROVIDERS[prov];
    const S = m === "with" ? withSteps(P, prov) : WITHOUT;
    cancel(loopTimer);
    finished = false;
    benchNote.textContent = "";
    scroll.classList.remove("free");
    closeAll();
    fqShown = false;
    stage.classList.remove("busy");
    fqPending = false;
    cancel(fqTimer);
    items.laptop.classList.remove("warned");
    dismissed.clear();
    autoQueue.clear();
    if (m === "with") autoOpen("laptop");
    transcript.innerHTML = "";
    term.innerHTML = "";
    lastKind = "";
    for (const k of ["sandbox", "preview", "cloud"] as const) {
      slots[k].classList.remove("on", "fresh");
      need("[data-empty]", slots[k]).textContent = S.empty[k];
    }
    syncStatus();
    setLaptop({
      cpu: 6,
      mem: 4.8,
      bat: [92, "7h"],
      status: "Waiting for a request.",
      procs: [["opencode", "idle"]],
    });
    setHints(false);
    input.innerHTML = '<span class="t-caret"></span>';
    if (!(await wait(500, id))) return;

    for (const st of S.steps) {
      if (st.user) {
        if (!(await typeUser(st.user, id))) return;
        addEl(`<div class="t-user">${esc(st.user)}</div>`);
        setHints(true);
        if (!(await wait(650, id))) return;
        continue;
      }
      if (st.text) {
        addEl(
          `<p class="t-text">${md(st.text).replace(/\{P\}/g, `<span data-pname>${esc(PROVIDERS[prov].name)}</span>`)}</p>`,
        );
        setLaptop(st.laptop);
        if (!(await wait(1000, id))) return;
        continue;
      }
      if (st.foot) {
        addEl(`<div class="t-foot"><b>▣ Build</b> · Claude Sonnet 5.5 · ${esc(st.foot)}</div>`);
        setHints(false);
        if (!(await wait(700, id))) return;
        continue;
      }
      if (st.tool === "read") {
        addEl(
          `<div class="t-inline"><span>→</span><span>Read ${esc(st.sub ?? "")}</span></div>`,
          "inline",
        );
        if (!(await wait(500, id))) return;
        continue;
      }
      if (st.tool === "edit") {
        addEl(
          `<div class="t-block"><div class="hd">← Edit src/api/checkout.ts</div>${diffHtml()}</div>`,
        );
        setLaptop(st.laptop);
        if (!(await wait(st.dur ?? 0, id))) return;
        continue;
      }
      if (st.tool === "shell") {
        const el = addEl(
          `<div class="t-block"><div>$ ${esc(st.cmd ?? "")}</div><div class="o"></div></div>`,
        );
        setLaptop(st.laptop);
        const o = need(".o", el);
        const out = st.out ?? [];
        for (const line of out) {
          addLine(o, esc(line));
          if (!(await wait((st.dur ?? 0) / out.length, id))) return;
        }
        if (!(await wait(350, id))) return;
        continue;
      }
      if (st.tool === "plugin") {
        const el = addEl(
          `<div class="t-inline"><span class="g"><span class="spin-t">${SPIN[spinI]}</span></span><span class="args"><span class="n">${st.name}</span> ${st.argsHtml ?? esc(st.args ?? "")}</span></div>`,
          "inline",
        );
        if (st.term && st.stream) {
          if (!(await streamTerm(st.term, id, true))) return;
        } else {
          if (!(await wait(st.dur ?? 0, id))) return;
          if (st.term) await streamTerm(st.term, id, false);
        }
        need(".g", el).textContent = "✓";
        addLine(el, st.resHtml ?? esc(st.res ?? ""), "res");
        if (st.attach) slots[st.attach].classList.add("on", "fresh");
        if (!(await wait(420, id))) return;
        continue;
      }
      if (st.tool === "cloud") {
        const pad = (k: string) => k.padEnd(21, " ");
        const el = addEl(
          `<div class="t-block"><div class="hd"># Cloud handoff <span class="spin-t">${SPIN[spinI]}</span></div><div class="o"></div></div>`,
        );
        const o = need(".o", el);
        setLaptop(st.laptop);
        const lines = st.lines ?? [];
        for (const [k, v] of lines) {
          addLine(o, `${esc(pad(k))}<span style="color:var(--t-text)">${esc(v)}</span>`);
          if (!(await wait((st.dur ?? 0) / (lines.length + 1), id))) return;
        }
        need(".hd", el).textContent = "# Cloud handoff";
        addLine(
          o,
          `<br><span class="hl">→ <span data-pname>${esc(PROVIDERS[prov].name)}</span> workspace ready on gitterm/checkout-coupons</span>\n${esc(pad("Pair your phone"))}<span class="url">gitterm.dev/pair/7QK-4M2</span>`,
        );
        slots.cloud.classList.add("on", "fresh");
        if (!(await wait(600, id))) return;
        continue;
      }
      if (st.laptop) {
        setLaptop(st.laptop);
        if (!(await wait(500, id))) return;
      }
    }
    setHints(false);
    // Let the last line finish growing, land on it, then hand scrolling to the reader
    later(
      () => {
        if (id !== run) return;
        scroll.scrollTop = scroll.scrollHeight;
        scroll.classList.add("free");
        finished = true;
        scheduleNext();
      },
      reduce ? 0 : 450,
    );
  }

  // After a run the demo plays again on the next provider, so no single one is the "default".
  // It waits while the demo is off screen, and stops if the reader scrolls the transcript.
  let loopTimer = 0;
  let finished = false;
  let readerScrolled = false;
  let benchVisible = false;
  function scheduleNext() {
    cancel(loopTimer);
    if (reduce || !finished || readerScrolled || !benchVisible || mode !== "with") return;
    // Someone is looking: don't replay under open windows or under the pointer
    if (stage.querySelector(".fw.open:not([data-auto])") || stage.matches(":hover")) {
      benchNote.textContent = "";
      return;
    }
    benchNote.textContent = "Plays again in a moment";
    loopTimer = later(() => void play("with"), 6000);
  }
  for (const ev of ["wheel", "touchmove"])
    scroll.addEventListener(
      ev,
      () => {
        if (!scroll.classList.contains("free")) return;
        readerScrolled = true;
        cancel(loopTimer);
        benchNote.textContent = "";
      },
      passive,
    );

  // ---------- OpenCode desktop (static, for the closing section) ----------
  function renderDesktop() {
    const P = PROVIDERS[prov];
    const html: string[] = [];
    for (const st of withSteps(P, prov).steps) {
      if (st.user)
        html.push(
          `<div class="oc-user${st.user === "/cloud" ? " cmd" : ""}"><div>${esc(st.user)}</div></div>`,
        );
      else if (st.text) html.push(`<p class="oc-text">${md(st.text.replace("{P}", P.name))}</p>`);
      else if (st.tool === "plugin")
        html.push(
          ocRow(
            "plugin",
            `Called <code>${st.name}</code>`,
            st.args ?? (st.argsHtml ?? "").replace(/<[^>]+>/g, ""),
            st.term ? `<div class="body">${st.term.map(color).join("\n")}</div>` : "",
          ),
        );
      else if (st.tool === "read") html.push(ocRow("read", "Read", st.sub ?? ""));
      else if (st.tool === "edit")
        html.push(
          ocRow(
            "edit",
            "Edit",
            "1 file",
            `<div class="body oc-diff"><div class="hd">src/api/checkout.ts</div>${DIFF.filter(
              ([c]) => c !== "cx",
            )
              .map(([c, , l]) => `<div class="${c}">${esc(l)}</div>`)
              .join("")}</div>`,
            true,
          ),
        );
      else if (st.tool === "cloud")
        html.push(
          ocRow(
            "cloud",
            "Cloud handoff",
            "41 messages, 2 unpublished commits, 3 uncommitted files, 6.4 MB",
          ),
        );
    }
    $("desk").innerHTML = html.join("");
    $("desk-loc").textContent = `${P.name} workspace`;
    const ds = $("desk-scroll");
    ds.scrollTop = ds.scrollHeight;
  }

  // ---------- Chapters: one scene per step, shown in the sticky window ----------
  const chaps = all(".chap");
  let scene = 0;
  function renderScenes() {
    const list = scenesFor(PROVIDERS[prov], prov);
    // Desktop: earlier steps stay above the current one, dimmed, like scrollback
    $("scenes").innerHTML = list
      .map(
        (h, i) =>
          `<div class="scene${i === scene ? " on" : ""}">${list
            .slice(0, i)
            .map((d) => `<div class="dim">${d}</div>`)
            .join("")}${h}</div>`,
      )
      .join("");
    chaps.forEach((c, i) => {
      need(".chap-scene", c).innerHTML =
        `<div class="tui"><div class="tui-chrome"><span class="lights"><i></i><i></i><i></i></span><span class="title">opencode · ~/code/shop</span></div><div class="scene">${list[i]}</div></div>`;
    });
  }
  function showScene(i: number) {
    scene = i;
    all("#scenes .scene").forEach((s, k) => s.classList.toggle("on", k === i));
    chaps.forEach((c, k) => c.classList.toggle("on", k === i));
  }
  const chapIO = observe(
    new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) showScene(Number((e.target as HTMLElement).dataset.scene));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    ),
  );
  for (const c of chaps) chapIO.observe(c);

  // ---------- Part 2: sessions move to the cloud, T3 Code starts new ones there ----------
  const ho = $("handoff");
  const hoLocal = $("ho-local");
  const hoCards = $("ho-cards");
  const hoLink = $("ho-link");
  let hoRun = 0;
  let hoVisible = false;
  let hoTimer = 0;
  let hoDone = false;
  const hoWait = (ms: number, id: number) =>
    reduce
      ? Promise.resolve(id === hoRun)
      : new Promise<boolean>((r) => later(() => r(id === hoRun), ms));
  const hoClock = (t: string, day?: string) => {
    $("ho-time").textContent = t;
    if (day) $("ho-day").textContent = day;
  };
  function hoCpu(v: number) {
    $("ho-cpu").textContent = `CPU ${v}%`;
    $("ho-cpu").classList.toggle("hot", v >= 70);
    $("ho-cpubar").style.width = `${v}%`;
    $("ho-cpubar").classList.toggle("cool", v < 40);
  }
  function packet(dir: "go" | "back") {
    hoLink.classList.remove("go", "back");
    void hoLink.offsetWidth;
    hoLink.classList.add(dir);
  }
  const agIcon = (s: Sess) =>
    `<span class="ag"><img src="${s.logo}" alt="${esc(s.agent)}">${s.t3 ? `<img class="ag-t3" src="/t3.svg" alt="">` : ""}</span>`;
  const rowHtml = (s: Sess, cls: string, note: string, tag: string) =>
    `<li class="srow ${cls}" data-s="${s.id}">${agIcon(s)}<div><b>${esc(s.title)}</b><small>${esc(note)}</small></div><span class="tag">${tag}</span></li>`;
  function setRow(id: string, cls: string, note: string, tag: string) {
    const el = need(`[data-s="${id}"]`, hoLocal);
    el.className = `srow ${cls}`;
    need("small", el).textContent = note;
    need(".tag", el).innerHTML = tag;
  }
  function card(s: Sess, fresh = false) {
    const [pn, pl] = s.prov ?? ["", ""];
    hoCards.insertAdjacentHTML(
      "beforeend",
      `<div class="card${fresh ? " fresh" : ""}" data-c="${s.id}"><div class="c-top">${agIcon(s)}<b>${esc(s.title)}</b><span class="c-tag">${fresh ? "New" : "/cloud"}</span><span class="c-prov"><img src="${pl}" alt="">${pn}</span></div><div class="c-st"><i class="spin2"></i><span>${esc(s.agent)}: ${esc(s.work ?? "")}</span></div></div>`,
    );
  }
  function cardDone(id: string, text = "") {
    const el = need(`[data-c="${id}"]`, hoCards);
    el.classList.add("done");
    need(".c-st span", el).textContent = text;
  }

  async function playHandoff() {
    const id = ++hoRun;
    cancel(hoTimer);
    hoDone = false;
    hoCards.innerHTML = "";
    hoLocal.innerHTML = SESS.map((s) =>
      rowHtml(s, "run", `${s.agent}, running locally`, "<i></i>Running"),
    ).join("");
    hoCpu(92);
    hoClock("18:40", "Tuesday evening");
    if (!(await hoWait(1200, id))) return;
    // Each OpenCode session moves with /cloud; the laptop gets lighter every time
    const cpu = [48, 10];
    for (const [i, s] of SESS.entries()) {
      setRow(s.id, "moving", "/cloud", '<i class="spin2"></i>Moving');
      packet("go");
      if (!(await hoWait(900, id))) return;
      setRow(s.id, "moved", `In the cloud on ${s.prov?.[0]}`, "In the cloud");
      card(s);
      hoCpu(cpu[i] ?? 10);
      hoClock(`18:4${1 + i}`);
      if (!(await hoWait(1000, id))) return;
    }
    // T3 Code starts Codex and Claude Code straight in the cloud: nothing leaves the laptop
    for (const s of FRESH) {
      card(s, true);
      if (!(await hoWait(800, id))) return;
    }
    hoClock("18:44");
    // The laptop is free for something else
    hoLocal.insertAdjacentHTML(
      "beforeend",
      rowHtml(
        { id: "rn", logo: "/opencode.svg", agent: "OpenCode", title: "Write the release notes" },
        "light",
        "OpenCode, on your laptop",
        "<i></i>Running",
      ),
    );
    hoCpu(14);
    hoClock("18:45");
    if (!(await hoWait(1400, id))) return;
    // Meanwhile the cloud finishes the work
    hoClock("18:58");
    cardDone("cc", FRESH[1]?.done);
    if (!(await hoWait(1000, id))) return;
    hoClock("19:03");
    cardDone("oc", SESS[0]?.done);
    if (!(await hoWait(1000, id))) return;
    hoClock("19:10");
    cardDone("cx", FRESH[0]?.done);
    if (!(await hoWait(1000, id))) return;
    hoClock("19:16");
    cardDone("o2", SESS[1]?.done);
    hoDone = true;
    hoSchedule();
  }
  function hoSchedule() {
    cancel(hoTimer);
    if (reduce || !hoDone || !hoVisible || ho.matches(":hover")) return;
    hoTimer = later(() => void playHandoff(), 9000);
  }
  ho.addEventListener("pointerleave", hoSchedule, on);
  ho.addEventListener("pointerenter", () => cancel(hoTimer), on);
  $("ho-replay").addEventListener("click", () => void playHandoff(), on);
  let hoStarted = false;
  observe(
    new IntersectionObserver(
      (es) => {
        hoVisible = es.some((e) => e.isIntersecting);
        if (!hoVisible) {
          cancel(hoTimer);
          return;
        }
        if (!hoStarted) {
          hoStarted = true;
          void playHandoff();
        } else hoSchedule();
      },
      { threshold: 0.35 },
    ),
  ).observe(ho);

  // ---------- Floating windows around the terminal ----------
  // Hover a status-bar item: its window peeks out below it. Click: it detaches to the side and can be
  // dragged or closed (it shrinks back into its item). Without Gitterm, a click gets you macOS's
  // version of the problem instead.
  let zTop = 10;
  let fqShown = false;
  const narrowStage = () => innerWidth <= 760;
  type Spot = [number, number, string?, string?];

  function place(w: HTMLElement, [x, y, ox, oy]: Spot) {
    w.style.setProperty("--x", `${Math.round(x)}px`);
    w.style.setProperty("--y", `${Math.round(y)}px`);
    if (ox !== undefined && oy !== undefined) {
      w.style.setProperty("--ox", ox);
      w.style.setProperty("--oy", oy);
    }
  }
  function itemAnchor(name: Slot, w: HTMLElement, forPeek = false): Spot {
    const sr = stage.getBoundingClientRect();
    const ir = items[name].getBoundingClientRect();
    const ww = w.offsetWidth;
    const wh = w.offsetHeight;
    const cx = ir.left - sr.left + ir.width / 2;
    const x = Math.max(8, Math.min(sr.width - ww - 8, cx - ww / 2));
    // Hover previews always hang below the bar, so they never cover the session
    if (forPeek && !narrowStage()) return [x, ir.bottom - sr.top + 10, `${cx - x}px`, "0%"];
    const y =
      (narrowStage() ? sbar.getBoundingClientRect().top - sr.top : ir.top - sr.top) - wh - 12;
    return [x, y, `${cx - x}px`, "100%"];
  }
  function openSpot(name: Slot, w: HTMLElement): Spot {
    const sr = stage.getBoundingClientRect();
    const ww = w.offsetWidth;
    const wh = w.offsetHeight;
    const floor = sbar.getBoundingClientRect().top - sr.top - wh - 14;
    if (narrowStage())
      return [w.classList.contains("phone") ? (sr.width - ww) / 2 : 8, Math.max(44, floor)];
    if (w.classList.contains("alert") && name !== "laptop") {
      // Alerts rise from their own item, so it is clear which part of the laptop gave up.
      // Force Quit is the exception: it takes the laptop's slot beside the terminal.
      const ir = items[name].getBoundingClientRect();
      const cx = ir.left - sr.left + ir.width / 2;
      return [Math.max(16, Math.min(sr.width - ww - 16, cx - ww / 2)), Math.max(48, floor - 36)];
    }
    // Open windows sit beside the terminal: laptop and sandbox stacked on the left, preview and
    // phone on the right. Side space runs to the browser edge (12px margin), not just the demo area.
    const tr = need(".tui.main", stage).getBoundingClientRect();
    const gapL = tr.left - 12;
    const gapR = innerWidth - 12 - tr.right;
    const isOpen = (n: Slot) => wins[n].classList.contains("open");
    if (w.classList.contains("phone")) {
      // The phone opens at 82% (scaled from its top-left corner), under the preview if that is open
      const vw = ww * 0.82;
      const x = gapR >= vw + 12 ? tr.right - sr.left + 12 : innerWidth - 12 - vw - sr.left;
      return [x, isOpen("preview") ? wins.preview.offsetHeight + 16 : 0, "0px", "0%"];
    }
    // Room to spare: sit 12px off the terminal. A tight fit: hug the page edge (4px).
    const xl = (gapL >= ww + 12 ? tr.left - ww - 12 : 4) - sr.left;
    const xr = (gapR >= ww + 12 ? tr.right + 12 : innerWidth - 4 - ww) - sr.left;
    if (name === "preview") return [xr, 0];
    if (name === "sandbox")
      return [xl, isOpen("laptop") ? Math.min(tr.height - wh, wins.laptop.offsetHeight + 16) : 0];
    return [xl, 0];
  }

  const nameOf = (w: HTMLElement) => (w.dataset.win ?? w.dataset.alert) as Slot;
  const front = (w: HTMLElement) => (w.style.zIndex = String(++zTop));
  // Hover previews whatever a click would open, so without Gitterm you see the macOS alert
  const winFor = (name: Slot) => (mode === "without" ? alerts[name] : wins[name]);
  const openFor = (name: Slot) =>
    [wins[name], alerts[name]].some((w) => w?.classList.contains("open"));
  const syncExpanded = (name: Slot) =>
    items[name].setAttribute("aria-expanded", String(openFor(name)));

  let hideTimer = 0;
  let peeked: HTMLElement | null = null;
  function peek(name: Slot) {
    cancel(hideTimer);
    const w = winFor(name);
    if (peeked && peeked !== w) {
      peeked.classList.remove("peek");
      peeked = null;
    }
    if (w.classList.contains("open")) return;
    place(w, itemAnchor(name, w, true));
    w.classList.add("peek");
    peeked = w;
  }
  function unpeek(now = false) {
    const go = () => {
      peeked?.classList.remove("peek");
      peeked = null;
    };
    cancel(hideTimer);
    if (now) go();
    else hideTimer = later(go, 160);
  }
  function openWin(name: Slot) {
    const w = winFor(name);
    // Phones have room for one window at a time
    if (narrowStage()) for (const o of all(".fw.open", stage)) if (o !== w) closeWin(o);
    if (w.classList.contains("open")) {
      front(w);
      return;
    }
    if (peeked && peeked !== w) unpeek(true);
    if (w.classList.contains("peek")) {
      w.classList.remove("peek");
      peeked = null;
    } else {
      w.classList.add("dragging");
      place(w, itemAnchor(name, w));
      void w.offsetHeight;
      w.classList.remove("dragging");
    }
    place(w, openSpot(name, w));
    w.classList.add("open");
    front(w);
    syncExpanded(name);
    cancel(loopTimer);
    benchNote.textContent = "";
  }
  function closeWin(w: HTMLElement) {
    const name = nameOf(w);
    if (w.dataset.win) dismissed.add(name);
    delete w.dataset.auto;
    place(w, itemAnchor(name, w));
    w.classList.remove("open", "peek");
    delete w.dataset.moved;
    syncExpanded(name);
    scheduleNext();
  }
  function closeAll() {
    for (const w of [...Object.values(wins), ...Object.values(alerts)]) {
      w.classList.remove("open", "peek");
      delete w.dataset.moved;
      delete w.dataset.auto;
    }
    for (const n of Object.keys(items) as Slot[]) syncExpanded(n);
    peeked = null;
  }

  // ---------- Windows that open on their own, only while someone is watching ----------
  // "Watching" = a good part of the demo is on screen (420px, or half a short screen), the page has
  // settled (no scroll for 600ms) and the tab is in front. Anything that attaches while nobody is
  // watching waits in a queue and opens once they are.
  let lastScroll = 0;
  let benchVisiblePx = 0;
  window.addEventListener("scroll", () => (lastScroll = Date.now()), passive);
  observe(
    new IntersectionObserver(
      (es) => {
        benchVisiblePx = es[es.length - 1]?.intersectionRect.height ?? 0;
      },
      { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    ),
  ).observe(stage);
  const watching = () =>
    !reduce &&
    !narrowStage() &&
    !document.hidden &&
    benchVisiblePx >= Math.min(420, innerHeight * 0.5) &&
    Date.now() - lastScroll > 600;
  const autoQueue = new Set<Slot>();
  const dismissed = new Set<Slot>();
  function autoOpen(name: Slot) {
    if (mode !== "with" || dismissed.has(name)) return;
    autoQueue.add(name);
    flushAuto();
  }
  let fqPending = false;
  let fqTimer = 0;
  function dismissFq() {
    cancel(fqTimer);
    const fq = alerts.laptop;
    if (fq.classList.contains("open") && fq.dataset.auto) closeWin(fq);
  }
  function flushAuto() {
    if (fqPending && mode === "without" && watching()) {
      fqPending = false;
      openWin("laptop");
      alerts.laptop.dataset.auto = "1";
      fqTimer = later(dismissFq, 6000);
    }
    if (!autoQueue.size || !watching()) return;
    for (const name of autoQueue) {
      const w = wins[name];
      if (
        slots[name].classList.contains("on") &&
        !w.classList.contains("open") &&
        !dismissed.has(name)
      ) {
        if (peeked === w) {
          w.classList.remove("peek");
          peeked = null;
        }
        openWin(name);
        w.dataset.auto = "1";
      }
      autoQueue.delete(name);
    }
  }
  intervals.push(window.setInterval(flushAuto, 300));

  // Desktop opens windows on its own, so it needs no hint. Phones don't, so they get one, once.
  const coach = $("coach");
  let coachDone = false;
  let coachTimer = 0;
  function showCoach(name: Slot) {
    if (coachDone || reduce || !narrowStage()) return;
    coachDone = true;
    const sr = stage.getBoundingClientRect();
    const ir = items[name].getBoundingClientRect();
    coach.classList.add("on");
    const cw = coach.offsetWidth;
    const cx = ir.left - sr.left + ir.width / 2;
    const x = Math.max(8, Math.min(sr.width - cw - 8, cx - cw / 2));
    coach.style.left = `${x}px`;
    coach.style.top = `${ir.top - sr.top - coach.offsetHeight - 12}px`;
    coach.style.setProperty("--ax", `${cx - x}px`);
    coachTimer = later(hideCoach, 9000);
  }
  function hideCoach() {
    cancel(coachTimer);
    coach.classList.remove("on");
    coachDone = true;
  }

  for (const [name, b] of Object.entries(items) as [Slot, HTMLElement][]) {
    b.addEventListener(
      "pointerenter",
      (e) => {
        hideCoach();
        if (e.pointerType === "mouse") peek(name);
      },
      on,
    );
    b.addEventListener(
      "pointerleave",
      (e) => {
        if (e.pointerType === "mouse") unpeek();
      },
      on,
    );
    b.addEventListener(
      "focus",
      () => {
        if (b.matches(":focus-visible")) peek(name);
      },
      on,
    );
    b.addEventListener("blur", () => unpeek(), on);
    b.addEventListener(
      "click",
      () => {
        hideCoach();
        const w = winFor(name);
        if (w.classList.contains("open")) closeWin(w);
        else openWin(name);
      },
      on,
    );
  }
  for (const w of [...Object.values(wins), ...Object.values(alerts)]) {
    w.addEventListener(
      "pointerenter",
      () => {
        if (w.classList.contains("peek")) cancel(hideTimer);
      },
      on,
    );
    w.addEventListener(
      "pointerleave",
      () => {
        if (w.classList.contains("peek")) unpeek();
      },
      on,
    );
    w.addEventListener(
      "pointerdown",
      () => {
        if (!w.classList.contains("open")) return;
        front(w);
        delete w.dataset.auto;
      },
      on,
    );
    w.querySelector(".l-close")?.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        closeWin(w);
      },
      on,
    );
    for (const b of all("[data-dismiss]", w)) b.addEventListener("click", () => closeWin(w), on);
    for (const b of all("[data-shake]", w))
      b.addEventListener(
        "click",
        () => {
          w.classList.remove("shake");
          void w.offsetWidth;
          w.classList.add("shake");
        },
        on,
      );
    // Drag by the title bar, anywhere across the page
    const bar = w.querySelector<HTMLElement>(".fw-bar, .ph-grab");
    if (!bar) continue;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    let drag = false;
    bar.addEventListener(
      "pointerdown",
      (e) => {
        if (!w.classList.contains("open") || (e.target as Element).closest("button")) return;
        drag = true;
        bar.setPointerCapture(e.pointerId);
        sx = e.clientX;
        sy = e.clientY;
        ox = parseFloat(w.style.getPropertyValue("--x")) || 0;
        oy = parseFloat(w.style.getPropertyValue("--y")) || 0;
        w.classList.add("dragging");
      },
      on,
    );
    bar.addEventListener(
      "pointermove",
      (e) => {
        if (!drag) return;
        const sr = stage.getBoundingClientRect();
        const x = Math.max(
          4 - sr.left,
          Math.min(innerWidth - sr.left - w.offsetWidth - 4, ox + e.clientX - sx),
        );
        const y = Math.max(0, Math.min(sr.height - 40, oy + e.clientY - sy));
        place(w, [x, y]);
        w.dataset.moved = "1";
      },
      on,
    );
    const end = () => {
      drag = false;
      w.classList.remove("dragging");
    };
    bar.addEventListener("pointerup", end, on);
    bar.addEventListener("pointercancel", end, on);
  }
  stage.addEventListener("pointerleave", () => scheduleNext(), on);
  stage.addEventListener(
    "pointerenter",
    () => {
      cancel(loopTimer);
      benchNote.textContent = "";
    },
    on,
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      const top = all(".fw.open", stage).sort(
        (a, b) => (Number(b.style.zIndex) || 0) - (Number(a.style.zIndex) || 0),
      )[0];
      if (top) closeWin(top);
    },
    on,
  );
  window.addEventListener(
    "resize",
    () => {
      for (const w of all(".fw.open", stage))
        if (!w.dataset.moved) place(w, openSpot(nameOf(w), w));
    },
    on,
  );

  // Status bar mirrors the session: what is attached, and what that costs your laptop
  function syncStatus() {
    const P = PROVIDERS[prov];
    const isOn = (n: Slot) => slots[n].classList.contains("on");
    const emptyText =
      mode === "without"
        ? { sandbox: "None", preview: "localhost only", cloud: "Lid stays open" }
        : { sandbox: "Not yet", preview: "Not yet", cloud: "On /cloud" };
    const val = {
      sandbox: `<img src="${P.logo}" alt=""><span>${esc(P.name)}</span>`,
      preview: `<span>:3000, ${P.publicPreviews ? "public" : "private"}</span>`,
      cloud: "<span>On your phone</span>",
    };
    for (const n of ["sandbox", "preview", "cloud"] as const) {
      items[n].classList.toggle("on", isOn(n));
      need(`[data-sv="${n}"]`, stage).innerHTML = isOn(n) ? val[n] : `<span>${emptyText[n]}</span>`;
    }
  }
  for (const name of ["sandbox", "preview", "cloud"] as const) {
    const slot = slots[name];
    let was = slot.classList.contains("on");
    observe(
      new MutationObserver(() => {
        const now = slot.classList.contains("on");
        if (now === was) return;
        was = now;
        syncStatus();
        if (now && mode === "with" && !reduce) {
          // Point at what just attached, and open its window if someone is watching
          items[name].classList.add("flash");
          later(() => items[name].classList.remove("flash"), 1400);
          showCoach(name);
          autoOpen(name);
        }
      }),
    ).observe(slot, { attributes: true, attributeFilter: ["class"] });
  }
  function laptopStatus(l: Laptop) {
    $("sb-cpu").textContent = `CPU ${l.cpu}%`;
    if (l.bat) $("sb-bat").textContent = `${l.bat[0]}%`;
    $("sb-meter").style.width = `${Math.max(4, l.cpu)}%`;
    $("sb-meter").classList.toggle("hot", l.cpu >= 70);
    items.laptop.classList.toggle("hot", l.cpu >= 70);
    stage.classList.toggle("busy", mode === "without" && l.cpu >= 90);
    // Without Gitterm the Mac gives up once: the Force Quit window appears on its own
    if (mode === "without" && l.cpu >= 90 && !fqShown && !reduce) {
      fqShown = true;
      fqPending = true;
      items.laptop.classList.add("warned");
      showCoach("laptop");
      flushAuto();
    }
    // Once the CPU settles, a Force Quit window that opened on its own goes back into its item
    if (mode === "without" && l.cpu < 70) dismissFq();
  }

  // ---------- Provider picker ----------
  function setProvider(id: SandboxProviderId) {
    prov = id;
    const P = PROVIDERS[id];
    for (const b of all("[data-prov]", strip))
      b.setAttribute("aria-pressed", String(b.dataset.prov === id));
    syncStatus();
    for (const i of all<HTMLImageElement>("img[data-plogo]")) {
      i.removeAttribute("srcset");
      i.src = P.logo;
    }
    for (const n of all("[data-pname]")) n.textContent = P.name;
    for (const n of all("[data-pid]")) n.textContent = id;
    for (const n of all("[data-pacct]")) n.textContent = acctOf(P);
    for (const n of all("[data-ppub]")) n.textContent = P.publicPreviews ? "public" : "private";
    $("sbxfoot").textContent = `${P.byoKey ? "Your key" : "Gitterm plan"}, 60 minute lifetime`;
    const pv = $("pvfoot");
    pv.classList.toggle("pub", P.publicPreviews);
    pv.title = P.publicPreviews
      ? "Public: anyone with the link can open it"
      : "Private: only you can open it";
    renderDesktop();
    renderScenes();
  }

  root.addEventListener(
    MODE_EVENT,
    (e) => {
      readerScrolled = false;
      void play((e as CustomEvent<DemoMode>).detail);
    },
    on,
  );
  // Picking a provider swaps it in place (no restart) and holds that choice for a while
  let pickedUntil = 0;
  for (const b of all("[data-prov]", strip))
    b.addEventListener(
      "click",
      () => {
        pickedUntil = Date.now() + 15000;
        setProvider(b.dataset.prov as SandboxProviderId);
      },
      on,
    );
  $("replay").addEventListener(
    "click",
    () => {
      readerScrolled = false;
      void play(mode);
    },
    on,
  );

  // The provider row moves on by itself every few seconds while it or the demo is on screen.
  // It holds still while someone is pointing at it, has a window open, or just picked one.
  let stripVisible = false;
  function cycleTick() {
    later(cycleTick, 4000);
    if (reduce || document.hidden || !(benchVisible || stripVisible) || Date.now() < pickedUntil)
      return;
    if (
      stage.querySelector(".fw.open:not([data-auto]), .fw.peek") ||
      stage.matches(":hover") ||
      strip.matches(":hover")
    )
      return;
    setProvider(ORDER[(ORDER.indexOf(prov) + 1) % ORDER.length] ?? "e2b");
  }
  observe(
    new IntersectionObserver((es) => (stripVisible = es.some((e) => e.isIntersecting)), {
      threshold: 0.5,
    }),
  ).observe(strip);

  setProvider(prov);
  showScene(0);
  setHints(false);

  // Start once the demo is on screen
  let started = false;
  const io = observe(
    new IntersectionObserver(
      (entries) => {
        benchVisible = entries.some((e) => e.isIntersecting);
        if (!benchVisible) {
          cancel(loopTimer);
          benchNote.textContent = "";
          return;
        }
        if (!started) {
          started = true;
          void play(mode);
          if (!reduce) later(cycleTick, 4000);
        } else scheduleNext();
      },
      { threshold: 0.25 },
    ),
  );
  if (reduce) {
    started = true;
    void play(mode);
  } else io.observe(stage);

  return () => {
    run = -1;
    hoRun = -1;
    ac.abort();
    for (const t of timeouts) clearTimeout(t);
    timeouts.clear();
    for (const i of intervals) clearInterval(i);
    for (const o of observers) o.disconnect();
    cancelAnimationFrame(raf);
  };
}
