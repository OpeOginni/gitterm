import { Cloud, Save, Layers, Power, Globe, MonitorSmartphone } from "lucide-react";
import { GitHub } from "../logos/Github";

const features = [
  {
    icon: Layers,
    title: "One API. Any cloud.",
    description:
      "Railway, E2B, Daytona, deploy complete opencode worksapces across any provider from a single interface.",
    lead: true,
  },
  {
    icon: Cloud,
    title: "Instant Workspaces",
    description: "Full OpenCode environment in seconds. Pick a provider and go.",
  },
  {
    icon: GitHub,
    title: "GitHub Native",
    description: "Clone repos, push commits, and open PRs from any workspace.",
  },
  {
    icon: MonitorSmartphone,
    title: "Editor Access",
    description: "Connect VS Code, Cursor, Zed, or NeoVim over SSH.",
  },
  {
    icon: Save,
    title: "Persistent State",
    description: "Files, context, and agent memory carry over between sessions.",
  },
  {
    icon: Globe,
    title: "Provider Agnostic",
    description: "Move workspaces between providers without friction.",
  },
  {
    icon: Power,
    title: "Smart Resources",
    description: "Idle workspaces sleep. You only pay for what you use.",
  },
];

export function FeaturesSection() {
  const lead = features[0]!;
  const rest = features.slice(1);

  return (
    <section id="features" className="border-t border-white/[0.06] py-24 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        {/* Section header */}
        <div className="mb-14 max-w-xl">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-primary/70">
            Capabilities
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Everything you need to run OpenCode in the cloud.
          </h2>
        </div>

        {/* Lead feature -- same row style, slightly elevated */}
        <div className="flex items-start gap-4 border-l-2 border-primary/50 py-5 pl-6">
          <div className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <lead.icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white md:text-lg">{lead.title}</h3>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-white/45">
              {lead.description}
            </p>
          </div>
        </div>

        {/* Supporting features -- 2-col rows */}
        <div className="mt-6 grid gap-x-6 gap-y-0 md:grid-cols-2">
          {rest.map((feature) => (
            <div
              key={feature.title}
              className="flex items-start gap-4 border-t border-white/[0.04] py-6"
            >
              <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
                <feature.icon className="h-[18px] w-[18px] text-primary/80" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-white/85">{feature.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-white/40">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
