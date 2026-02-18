const steps = [
  {
    number: "01",
    title: "Sign in",
    description: "Authenticate with GitHub. Your dashboard is ready in seconds.",
  },
  {
    number: "02",
    title: "Create a workspace",
    description:
      "Pick a model provider, choose your infra, and connect a repo.",
  },
  {
    number: "03",
    title: "Ship",
    description:
      "OpenCode runs in the cloud with persistent state. Resume from any device.",
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

        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((step, idx) => (
            <div
              key={step.number}
              className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
            >
              {/* Step number */}
              <span className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-primary/20 bg-primary/10 font-mono text-sm font-bold text-primary">
                {step.number}
              </span>

              {/* Connector line between cards (desktop only) */}
              {idx < steps.length - 1 && (
                <div className="pointer-events-none absolute right-0 top-1/2 hidden h-px w-4 -translate-y-1/2 translate-x-full bg-white/[0.06] md:block" />
              )}

              <h3 className="mb-2 text-lg font-semibold text-white/90">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-white/45">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
