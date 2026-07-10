import { Layers, KeyRound, MonitorSmartphone, Save, GitBranch, Globe } from "lucide-react";

const features = [
  {
    icon: Layers,
    title: "Any cloud you want.",
    description: "Run on E2B, Daytona, Railway, AWS, or Cloudflare — pick what fits.",
  },
  {
    icon: KeyRound,
    title: "Configure once.",
    description: "Set your model keys, SSH, and agent config once; every workspace inherits them.",
  },
  {
    icon: MonitorSmartphone,
    title: "Resume from any device.",
    description: "Browser terminal, SSH editor, or agent client — same workspace, any screen.",
  },
  {
    icon: Save,
    title: "Persistent state.",
    description: "Files, context, and checkpoints survive restarts. Stop today, resume tomorrow.",
  },
  {
    icon: GitBranch,
    title: "Your repos, your commits.",
    description: "Connect GitHub and clone, commit, push, and open PRs straight from the terminal.",
  },
  {
    icon: Globe,
    title: "Preview your app live.",
    description: "Expose any port behind a shareable URL to preview or share your running app.",
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
            A real <span className="font-display-italic text-[color:var(--cream)]">home</span> for
            your agent.
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
