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
    description: "Access your workspace instantly in the browser or attach to your OpenCode Client.",
  },
]

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="border-t border-border py-20 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">How it works</h2>
          <p className="mx-auto max-w-lg text-lg text-muted-foreground">
            Get your cloud workspace running in under a minute. No Docker, no config files, no hassle.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((step) => (
            <div key={step.number} className="relative">
              <div className="mb-4 font-mono text-5xl font-bold text-primary">{step.number}</div>
              <h3 className="mb-2 text-xl font-semibold text-foreground">{step.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>

        {/* Local Tunnel Alternative */}
        <div className="mt-16 rounded-lg border border-border bg-secondary/80 p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h3 className="text-xl font-semibold text-foreground mb-2">Prefer to run locally?</h3>
              <p className="text-muted-foreground max-w-xl">
                Use our CLI to tunnel your local dev server. Get a public gitterm.dev URL without deploying anything.
              </p>
            </div>
            <div className="font-mono text-sm bg-background rounded-lg px-4 py-3 border border-border">
              <span className="text-primary">$</span> npx @opeoginni/gitterm-agent connect --workspace-id "ws_abc123" --port 3000
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
