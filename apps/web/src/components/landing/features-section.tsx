import {
  Layers,
  KeyRound,
  MonitorSmartphone,
  Save,
  Globe,
  Users,
  TerminalSquare,
  Timer,
} from "lucide-react";

/**
 * Each feature is one "cell" in a blueprint grid. The mono `tag` reads like a
 * knob you'd set on a sandbox: short, lowercase, one idea. Keep tags honest -
 * they describe the capability, they are not CLI flags.
 */
const features = [
  {
    icon: Layers,
    tag: "cloud",
    title: "Pick your cloud",
    body: "Choose the provider that fits each job, from quick sandboxes to infrastructure you already trust.",
  },
  {
    icon: Timer,
    tag: "lifetime",
    title: "Short task or long run",
    body: "Launch a workspace for one quick job or keep it available for ongoing work. You decide when it stops.",
  },
  {
    icon: KeyRound,
    tag: "keys",
    title: "Set keys once",
    body: "Securely reuse your model and environment credentials without pasting secrets into every workspace.",
  },
  {
    icon: MonitorSmartphone,
    tag: "client",
    title: "Connect from any device",
    body: "Open the same workspace in your browser or local client and continue exactly where you left off.",
  },
  {
    icon: Save,
    tag: "pause",
    title: "Pause without losing progress",
    body: "Stop active compute, preserve the workspace state, and resume when you are ready to keep going.",
  },
  {
    icon: Globe,
    tag: "expose",
    title: "Share a live app preview",
    body: "Expose any workspace port through a shareable URL for testing, feedback, or a quick demo.",
  },
  {
    icon: Users,
    tag: "team",
    title: "Bring your team in",
    body: "Share a workspace with teammates when a task needs another set of eyes or a clean handoff.",
  },
  {
    icon: TerminalSquare,
    tag: "automate",
    title: "Automate with CLI or SDK",
    body: "Create and manage workspaces from scripts, internal tools, or the terminal you already use.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="border-t border-line py-14 sm:py-20 md:py-28">
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
        <div className="mb-10 flex flex-col gap-6 sm:mb-12 sm:flex-row sm:items-end sm:justify-between">
          <div className="mx-auto max-w-xl text-center sm:mx-0 sm:text-left">
            <h2 className="font-display text-[clamp(1.9rem,4vw,3.2rem)] font-light leading-[1.04] tracking-tight text-fg">
              Built for however you want to{" "}
              <span className="font-display-accent text-[color:var(--cream)]">work</span>.
            </h2>
          </div>
          <p className="marker hidden shrink-0 pb-2 sm:block">one workspace · your choices</p>
        </div>

        {/* Blueprint grid: hairline cells, crosshair ticks on the outer corners. */}
        <div className="blueprint relative">
          <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, index) => (
              <FeatureCell key={feature.title} index={index} {...feature} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureCell({
  index,
  icon: Icon,
  tag,
  title,
  body,
}: (typeof features)[number] & { index: number }) {
  return (
    <article className="feature-cell group relative flex min-h-[236px] flex-col bg-background p-5 transition-colors duration-300 hover:bg-card sm:p-6">
      {/* Prompt line: index + tag, like the header of a tiny terminal pane */}
      <div className="mb-7 flex items-center justify-between gap-3 font-mono text-[10.5px] tracking-[0.18em] text-fg-4">
        <span className="flex items-center gap-2.5">
          <span className="text-primary/80 transition-colors group-hover:text-primary">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="uppercase">{tag}</span>
        </span>
        <Icon className="h-4 w-4 text-fg-4 transition-colors duration-300 group-hover:text-primary" />
      </div>

      <h3 className="text-[16px] font-medium leading-snug text-fg sm:text-[17px]">{title}</h3>
      <p className="mt-2.5 text-[13.5px] leading-[1.65] text-fg-3">{body}</p>

      {/* Bottom rail fills gold on hover: the one moving part in the whole section */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-primary transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100"
      />
    </article>
  );
}
