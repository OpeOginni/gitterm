export function FeaturesSection() {
  return (
    <section id="features" className="border-t border-border py-24 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="mb-16 max-w-lg">
          <h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            What you get
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Everything needed to run OpenCode in the cloud. Nothing you don&apos;t.
          </p>
        </div>

        <div className="grid gap-x-16 gap-y-10 md:grid-cols-2">
          <Feature
            title="One API, any cloud"
            description="Railway, E2B, Daytona. Deploy complete OpenCode workspaces across any provider from a single interface. Switch providers without changing your workflow."
          />
          <Feature
            title="Instant workspaces"
            description="Full OpenCode environment in seconds. Pick a provider, point to a repo, and go. No Docker setup, no VM config."
          />
          <Feature
            title="GitHub native"
            description="Clone repos, push commits, and open PRs directly from any workspace. Your GitHub access carries across every session."
          />
          <Feature
            title="Editor access"
            description="Connect VS Code, Cursor, Zed, or Neovim over SSH. Work in your editor while the agent runs in the cloud."
          />
          <Feature
            title="Persistent state"
            description="Files, context, and agent memory carry over between sessions. Stop and resume without losing work."
          />
          <Feature
            title="Smart resources"
            description="Idle workspaces sleep automatically. You only pay for active compute time."
          />
        </div>
      </div>
    </section>
  );
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-t border-border pt-6">
      <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
