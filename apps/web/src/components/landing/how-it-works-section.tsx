const steps = [
  {
    number: "01",
    title: "Login to GitTerm",
    description: "Sign in with your GitHub account.",
  },
  {
    number: "02",
    title: "Create a workspace",
    description: "Choose your type of workspace Cloud or Local we handle the rest.",
  },
  {
    number: "03",
    title: "Start coding",
    description:
      "Access your workspace instantly in the browser or attach to your OpenCode Client.",
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="border-t border-border py-20 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-16 text-center">
          <p className="mb-3 inline-flex items-center rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            How it works
          </p>
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Launch an OpenCode workspace in minutes
          </h2>
          <p className="mx-auto max-w-lg text-lg text-muted-foreground">
            Create a cloud or local setup without Docker or config files. We handle the infra so
            you can focus on shipping.
          </p>
        </div>

        <div className="relative">
          <div className="absolute left-8 right-8 top-7 hidden h-px bg-border md:block" />
          <div className="grid gap-6 md:grid-cols-3">
            {steps.map((step) => (
              <div
                key={step.number}
                className="group relative z-10 rounded-2xl border border-border bg-background/70 p-6 shadow-sm backdrop-blur transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg"
              >
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary font-mono text-lg font-semibold text-primary">
                  {step.number}
                </div>
                <h3 className="mb-2 text-xl font-semibold text-foreground">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
