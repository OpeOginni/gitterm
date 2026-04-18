const steps = [
  {
    number: "01",
    title: "Sign in with GitHub",
    description: "Authenticate and your dashboard is ready. No setup wizards, no waiting.",
  },
  {
    number: "02",
    title: "Create a workspace",
    description:
      "Pick a cloud provider, point to a repo, and configure your model. One click to launch.",
  },
  {
    number: "03",
    title: "Ship",
    description:
      "OpenCode runs in the cloud with persistent state. Resume from any device, any time.",
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="border-t border-border py-24 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <h2 className="mb-16 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          How it works
        </h2>

        {/* Steps — horizontal on desktop, stacked on mobile */}
        <div className="grid gap-12 md:grid-cols-3 md:gap-8">
          {steps.map((step) => (
            <div key={step.number}>
              <span className="mb-4 block font-mono text-3xl font-bold text-primary/30">
                {step.number}
              </span>
              <h3 className="mb-2 text-lg font-semibold text-foreground">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
