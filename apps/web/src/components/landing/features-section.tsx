import { Cloud, Save, Layers, Power, Globe } from "lucide-react";
import { GitHub } from "../logos/Github";

const heroFeature = {
  icon: Layers,
  title: "One API. Any cloud.",
  description:
    "Railway, E2B, Cloudflare. GitTerm gives you a single interface to deploy and manage OpenCode workspaces across any provider, server, or sandbox. Switch infra without changing a line.",
};

const features = [
  {
    icon: Cloud,
    title: "Instant Cloud Workspaces",
    description:
      "Provision a full OpenCode environment in seconds. No Docker, no config files. Just pick a provider and go.",
  },
  {
    icon: GitHub,
    title: "GitHub Native",
    description:
      "Authenticate once. Clone repos, push commits, and open PRs from any workspace on any device.",
  },
  {
    icon: Save,
    title: "Persistent State",
    description:
      "Workspaces survive restarts. Files, context, and agent memory carry over between sessions. Pick up where you left off.",
  },
  {
    icon: Globe,
    title: "Provider Agnostic",
    description:
      "Not locked into one cloud. Move workspaces between Railway, E2B, and Cloudflare without friction.",
  },
  {
    icon: Power,
    title: "Smart Resource Management",
    description:
      "Idle workspaces sleep automatically and wake on demand. You only pay for what you actually use.",
  },
];

export function FeaturesSection() {
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

        {/* Hero feature -- full width, elevated */}
        <div className="group relative mb-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]">
          <div className="h-px w-full bg-primary" />
          <div className="grid items-center gap-6 p-8 md:grid-cols-[auto_1fr] md:gap-10 md:p-10">
            <div className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
              <heroFeature.icon className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h3 className="mb-2 text-xl font-bold text-white md:text-2xl">{heroFeature.title}</h3>
              <p className="max-w-2xl text-sm leading-relaxed text-white/45 md:text-base">
                {heroFeature.description}
              </p>
            </div>
          </div>
        </div>

        {/* Supporting features -- asymmetric grid: 2 top, 3 bottom */}
        <div className="grid gap-4 md:grid-cols-2">
          {features.slice(0, 2).map((feature) => (
            <div
              key={feature.title}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
            >
              <div className="h-px w-full bg-primary/40" />
              <div className="p-8">
                <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white/90">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-white/45">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {features.slice(2).map((feature) => (
            <div
              key={feature.title}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
            >
              <div className="h-px w-full bg-primary/40" />
              <div className="p-8">
                <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white/90">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-white/45">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
