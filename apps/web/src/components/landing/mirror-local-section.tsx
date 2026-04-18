import { KeyRound, ShieldCheck, FileJson } from "lucide-react";

const profileItems = [
  {
    icon: KeyRound,
    label: "Model credentials",
    detail: "Encrypted API keys for Anthropic, OpenAI, Copilot, and more.",
  },
  {
    icon: FileJson,
    label: "Agent config",
    detail: "Your opencode.json with theme, model, permissions, and tools.",
  },
  {
    icon: ShieldCheck,
    label: "SSH key",
    detail: "One key for editor access across every workspace.",
  },
];

export function MirrorLocalSection() {
  return (
    <section id="opencode-sync" className="border-t border-border py-24 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-start">
          {/* Left — copy */}
          <div className="lg:sticky lg:top-24">
            <h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
              Configure once.
              <br />
              <span className="text-muted-foreground">Every workspace inherits it.</span>
            </h2>
            <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
              Set up your credentials, agent config, and SSH key in the dashboard. New workspaces
              pick up the same profile automatically. No repeated setup.
            </p>
          </div>

          {/* Right — minimal list, no card wrapper */}
          <div className="space-y-0">
            {profileItems.map((item, i) => (
              <div
                key={item.label}
                className="flex items-start gap-4 border-b border-border py-6 first:pt-0 last:border-0"
              >
                <item.icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary/70" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{item.label}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {item.detail}
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
