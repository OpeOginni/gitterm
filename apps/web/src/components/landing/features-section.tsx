import { Layers, KeyRound, MonitorSmartphone, Save, GitBranch, Globe } from "lucide-react";

const features = [
  {
    icon: Layers,
    title: "Pick your cloud.",
    description: "E2B, Daytona, Railway, AWS, or Cloudflare. No lock-in.",
  },
  {
    icon: KeyRound,
    title: "Set keys once.",
    description: "Model keys, SSH, agent config. Ready in every workspace.",
  },
  {
    icon: MonitorSmartphone,
    title: "Any device.",
    description: "Browser, SSH, or agent client. Same session, any screen.",
  },
  {
    icon: Save,
    title: "Stays saved.",
    description: "Files, context, checkpoints. Stop today, resume tomorrow.",
  },
  {
    icon: GitBranch,
    title: "Your GitHub.",
    description: "Clone, commit, push, open PRs from the terminal.",
  },
  {
    icon: Globe,
    title: "Live previews.",
    description: "Expose a port. Share a URL.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="border-t border-white/[0.06] py-14 sm:py-20 md:py-28">
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
        <div className="mb-10 max-w-xl sm:mb-12">
          <div className="mb-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/[0.08]" />
            <span className="marker">What you get</span>
          </div>
          <h2 className="font-display text-[clamp(1.9rem,4vw,3.2rem)] font-light leading-[1.04] tracking-tight text-white">
            Built for how you actually{" "}
            <span className="font-display-italic text-[color:var(--cream)]">work</span>.
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-0 sm:gap-x-8">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="flex flex-col gap-3 border-t border-white/[0.06] py-6 sm:flex-row sm:items-start sm:gap-4"
            >
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] sm:mt-0.5">
                <feature.icon className="h-[18px] w-[18px] text-primary/80" />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold text-white/85 sm:text-[15px]">
                  {feature.title}
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-white/45 sm:text-sm">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
