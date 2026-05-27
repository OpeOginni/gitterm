import { Sliders, Rocket, Monitor, RotateCcw } from "lucide-react";

const steps = [
  {
    number: "01",
    title: "Set your profile",
    description:
      "Configure model keys, SSH, and agent settings once in the dashboard to automatically apply them to every workspace.",
    icon: Sliders,
  },
  {
    number: "02",
    title: "Launch",
    description:
      "Pick a cloud provider, paste a repo link, and we provision, install OpenCode, and boot your agent in under a minute.",
    icon: Rocket,
  },
  {
    number: "03",
    title: "Connect",
    description:
      "Connect via browser terminal, SSH from your editor, or opencode attach from any machine on your network.",
    icon: Monitor,
  },
  {
    number: "04",
    title: "Persist",
    description:
      "Stop today and resume tomorrow with your entire filesystem and agent context preserved exactly as you left it.",
    icon: RotateCcw,
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="border-t border-white/[0.06] py-14 sm:py-20 md:py-28">
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
        <div className="mb-10 max-w-xl sm:mb-12">
          <div className="mb-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/[0.08]" />
            <span className="marker">How it works</span>
          </div>
          <h2 className="font-display text-[clamp(1.9rem,4vw,3.2rem)] font-light leading-[1.04] tracking-tight text-white">
            How GitTerm moves your agent to the{" "}
            <span className="font-display-italic text-[color:var(--cream)]">cloud</span>.
          </h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div
              key={step.number}
              className="group relative rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 transition-colors hover:border-white/[0.12]"
            >
              <div className="mb-4 flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 font-mono text-sm font-bold text-primary">
                  {step.number}
                </span>
                <span className="h-px flex-1 bg-white/[0.06]" />
                <step.icon className="h-4 w-4 text-white/25 transition-colors group-hover:text-primary/60" />
              </div>
              <h3 className="mb-1.5 text-[15px] font-semibold text-white/90">{step.title}</h3>
              <p className="text-sm leading-snug text-white/45">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
