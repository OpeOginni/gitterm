import { Cloud, Save, Repeat } from "lucide-react";
import { GitHub } from "../logos/Github";

const features = [
  {
    icon: Cloud,
    title: "Cloud Workspaces",
    description:
      "Provision OpenCode on Railway, AWS, or Cloudflare in seconds. No Docker, no config files.",
    accent: "bg-blue-400/10 text-blue-400",
  },
  {
    icon: Repeat,
    title: "Agentic Loops",
    description:
      "Define a plan and let agents run autonomously -- editing, committing, and iterating across sessions.",
    accent: "bg-primary/10 text-primary",
  },
  {
    icon: GitHub,
    title: "GitHub Native",
    description:
      "Authenticate once. Clone repos, push commits, and open PRs from any workspace, any device.",
    accent: "bg-white/10 text-white/80",
  },
  {
    icon: Save,
    title: "Persistent State",
    description:
      "Workspaces survive restarts. Files, context, and agent memory carry over between sessions.",
    accent: "bg-emerald-400/10 text-emerald-400",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="border-t border-white/[0.06] py-24 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        {/* Section header -- left-aligned for editorial feel */}
        <div className="mb-14 max-w-xl">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-primary/70">
            Capabilities
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Everything your AI agents need to ship.
          </h2>
        </div>

        {/* 2x2 grid with generous cards */}
        <div className="grid gap-4 md:grid-cols-2">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group relative rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
            >
              <div
                className={`mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl ${feature.accent}`}
              >
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-white/90">
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-white/45">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
