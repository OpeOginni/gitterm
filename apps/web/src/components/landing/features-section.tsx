import { Cloud, Globe, Lock, Save, Zap } from "lucide-react";
import { GitHub } from "../logos/Github";

const features = [
  {
    icon: Cloud,
    title: "Cloud Workspaces",
    description: "Spin up OpenCode, and other AI coding agents instantly on Railway or AWS.",
  },
  {
    icon: Globe,
    title: "Local Tunnels",
    description:
      "Expose your local OpenCode server with a shareable gitterm.dev URL. No port forwarding needed.",
  },
  {
    icon: GitHub,
    title: "GitHub Integration",
    description:
      "Connect your GitHub account for seamless repo cloning and authenticated git operations.",
  },
  {
    icon: Save,
    title: "Persistent Storage",
    description: "Your workspace files persist across sessions. Pick up right where you left off.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="border-t border-border py-20 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-16 max-w-2xl">
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Everything you need for remote AI coding
          </h2>
          <p className="text-lg text-muted-foreground">
            A complete platform for running agentic coding environments. Cloud or local, we've got
            you covered.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 rounded-lg overflow-hidden">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-background p-4 transition-colors hover:bg-secondary"
            >
              <feature.icon className="mb-4 h-8 w-8 text-primary" />
              <h3 className="mb-2 text-lg font-semibold text-foreground">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
