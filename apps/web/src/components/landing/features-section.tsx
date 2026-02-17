import { Cloud, Globe, Lock, Save, Zap, Repeat } from "lucide-react";
import { GitHub } from "../logos/Github";

const features = [
  {
    icon: Cloud,
    title: "Cloud Workspaces",
    description: "Spin up OpenCode, and other AI coding agents instantly on Railway or AWS.",
  },
  {
    icon: Repeat,
    title: "Agentic Loops",
    description:
      "Create autonomous coding loops that execute tasks across multiple runs, read plan files, make changes, and commit progress automatically.",
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
          <p className="mb-3 inline-flex items-center rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Capabilities
          </p>
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Everything you need for remote AI coding with OpenCode
          </h2>
          <p className="text-lg text-muted-foreground">
            A complete platform for running agentic coding environments. Cloud or local, we've got
            you covered.
          </p>
        </div>

        <div className="relative">
          <div className="pointer-events-none absolute -inset-x-6 -top-6 hidden h-40 rounded-[28px] bg-gradient-to-r from-primary/10 via-transparent to-primary/10 md:block" />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-6 lg:[&>*:nth-child(4)]:col-start-2 lg:[&>*:nth-child(5)]:col-start-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group relative overflow-hidden rounded-2xl border border-border bg-background/70 p-6 shadow-sm backdrop-blur transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg md:col-span-1 lg:col-span-2"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="relative">
                  <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-primary ring-1 ring-border">
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
