const steps = [
  {
    number: "01",
    title: "Sign in",
    description: "Authenticate with GitHub. Your dashboard is ready in seconds.",
  },
  {
    number: "02",
    title: "Create a workspace",
    description: "Setup a model provider, and opencode config, and create a workspace from a repo.",
  },
  {
    number: "03",
    title: "Ship",
    description: "OpenCode runs in the cloud with persistent state. Resume from any device.",
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="border-t border-white/[0.06] py-24 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="mb-14 text-center">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-primary/70">
            How it works
          </p>
          <h2 className="mx-auto max-w-lg text-3xl font-bold tracking-tight text-white md:text-4xl">
            Three steps to a running workspace.
          </h2>
        </div>

        {/* Single card housing all steps */}
        <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
          <div className="h-px w-full bg-primary/40" />
          <div className="grid divide-y divide-white/[0.06] md:grid-cols-3 md:divide-x md:divide-y-0">
            {steps.map((step, idx) => (
              <div key={step.number} className="relative p-8 md:p-10">
                {/* Step number with connector */}
                <div className="mb-6 flex items-center gap-4">
                  <span className="relative z-10 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 font-mono text-sm font-bold text-primary">
                    {step.number}
                  </span>
                  {/* Dashed connector line -- stretches to the right edge */}
                  {idx < steps.length - 1 && (
                    <div className="hidden h-px flex-1 border-t border-dashed border-primary/20 md:block" />
                  )}
                </div>

                <h3 className="mb-2 text-lg font-semibold text-white/90">{step.title}</h3>
                <p className="text-sm leading-relaxed text-white/45">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
