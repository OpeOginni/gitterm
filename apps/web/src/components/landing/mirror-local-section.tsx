import { Check } from "lucide-react";

const configLines = [
  `{`,
  `  "$schema": "https://opencode.ai/config.json",`,
  `  "theme": "tokyonight",`,
  `  "permission": {`,
  `    "edit": "ask",`,
  `    "bash": "ask"`,
  `  }`,
  `}`,
];

export function MirrorLocalSection() {
  return (
    <section id="opencode-sync" className="border-t border-white/[0.06] py-24 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          {/* Left -- editorial copy */}
          <div>
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-primary/70">
              Workspace Profile
            </p>
            <h2 className="mb-5 text-3xl font-bold tracking-tight text-white md:text-4xl">
              One config. Multiple workspaces.
            </h2>
            <p className="mb-8 text-base leading-relaxed text-white/50 sm:text-lg">
              Add model provider keys in the dashboard, paste your OpenCode config once, and every
              new workspace starts with the same tools, theme, and permissions.
            </p>
            <div className="space-y-4">
              {[
                "Authenticate model providers with API keys or OAuth",
                "Paste once, reuse the same config across all workspaces",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm text-white/55">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* Right -- config card */}
          <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <div className="h-px w-full bg-primary/40" />
            <div className="p-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-white/80">opencode.json</span>
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-primary">
                  Synced
                </span>
              </div>

              <div className="mt-5 max-w-full overflow-hidden rounded-xl border border-white/[0.06] bg-[#09090b]">
                <div className="overflow-x-auto p-5">
                  <table className="w-full border-collapse">
                    <tbody>
                      {configLines.map((line, i) => (
                        <tr key={i}>
                          <td className="select-none pr-4 text-right align-top font-mono text-xs leading-relaxed text-primary/25 sm:text-sm">
                            {i + 1}
                          </td>
                          <td className="whitespace-pre font-mono text-xs leading-relaxed text-white/50 sm:text-sm">
                            {line}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
