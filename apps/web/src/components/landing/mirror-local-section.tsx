import { KeyRound, ShieldCheck, FileJson } from "lucide-react";
import { GitHub as Github } from "../logos/Github";

const profileItems = [
  {
    icon: KeyRound,
    label: "Model Credentials",
    detail: "Encrypted API keys and OAuth tokens for Anthropic, OpenAI, Copilot, and more.",
  },
  {
    icon: FileJson,
    label: "Agent Config",
    detail: "Your opencode.json -- theme, model, permissions, and tools.",
  },
  {
    icon: ShieldCheck,
    label: "SSH Public Key",
    detail: "One key for editor access across every workspace.",
  },
];

export function MirrorLocalSection() {
  return (
    <section id="opencode-sync" className="border-t border-white/[0.06] py-24 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          {/* Left -- copy */}
          <div>
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-primary/70">
              Workspace Profile
            </p>
            <h2 className="mb-5 text-3xl font-bold tracking-tight text-white md:text-4xl">
              Set up once. Every workspace just works.
            </h2>
            <p className="text-base leading-relaxed text-white/50 sm:text-lg">
              Configure your credentials, agent config, SSH key, and GitHub access in the dashboard.
              Every new workspace inherits the same setup automatically.
            </p>
          </div>

          {/* Right -- settings-style card */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <div className="h-px w-full bg-primary/40" />
            <div className="divide-y divide-white/[0.04]">
              {profileItems.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-4 px-6 py-5 transition-colors hover:bg-white/[0.02]"
                >
                  <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <item.icon className="h-[18px] w-[18px] text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white/80">{item.label}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-white/35">{item.detail}</p>
                  </div>
                  <span className="hidden shrink-0 rounded-full border border-primary/15 bg-primary/8 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-primary/70 sm:block">
                    Synced
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
