import { Layers, KeyRound, MonitorSmartphone, Save, GitBranch } from "lucide-react";

const features = [
  {
    icon: Layers,
    title: "Your laptop, off the hook.",
    description:
      "Workspaces run on E2B, Daytona, Railway, or Cloudflare. Pick the cloud that fits your workload.",
  },
  {
    icon: KeyRound,
    title: "Configure once.",
    description:
      "Add your model keys, SSH key, and agent config. Every new workspace inherits the setup.",
  },
  {
    icon: MonitorSmartphone,
    title: "Securely resume from any device.",
    description:
      "Browser terminal, attach to any supported agent client or open in your favourite SSH-aware editor. Same workspace, any screen.",
  },
  {
    icon: Save,
    title: "Persistent state.",
    description: "Files, context, and checkpoints survive restarts. Stop today, pick up tomorrow.",
  },
  {
    icon: GitBranch,
    title: "Your repos, your commits.",
    description:
      "Connect your GitHub account and work with your repos directly. Clone, commit, push, and open pull requests from the workspace terminal.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="border-t border-white/[0.06] py-20 md:py-28">
      <div className="mx-auto max-w-[1100px] px-6">
        <div className="mb-12 max-w-xl">
          <div className="mb-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/[0.08]" />
            <span className="marker">What you get</span>
          </div>
          <h2 className="font-display text-[clamp(1.9rem,4vw,3.2rem)] font-light leading-[1.04] tracking-tight text-white">
            A real <span className="font-display-italic text-[color:var(--cream)]">home</span> for
            your agent.
          </h2>
        </div>

        <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="flex items-start gap-4 border-t border-white/[0.06] py-6"
            >
              <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
                <feature.icon className="h-[18px] w-[18px] text-primary/80" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-white/85">{feature.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-white/45">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
