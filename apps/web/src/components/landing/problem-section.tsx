import { Cpu, MonitorSmartphone, Network } from "lucide-react";

const capabilities = [
  {
    icon: Cpu,
    title: "Real compute, on demand.",
    body: "Hand giant monorepos and long agent loops to cloud hardware your laptop can't match.",
  },
  {
    icon: MonitorSmartphone,
    title: "Any device, same session.",
    body: "Move from desk to iPad to a borrowed laptop — browser terminal or SSH, always the same workspace.",
  },
  {
    icon: Network,
    title: "Nothing runs on your machine.",
    body: "Try unknown repos, expose dev servers, let agents loose — all sandboxed, far from your laptop.",
  },
];

export function ProblemSection() {
  return (
    <section
      id="problem"
      className="relative overflow-hidden border-t border-white/[0.06] py-14 sm:py-20 md:py-28"
    >
      <div className="relative mx-auto max-w-[1100px] px-4 sm:px-6">
        <div className="mb-10 max-w-2xl sm:mb-12">
          <div className="mb-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/[0.08]" />
            <span className="marker">Beyond local development</span>
          </div>
          <h2 className="font-display text-[clamp(1.9rem,4vw,3.2rem)] font-light leading-[1.04] tracking-tight text-white">
            Some things your laptop can&apos;t do{" "}
            <span className="font-display-italic text-[color:var(--cream)]">alone</span>.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-[1.65] text-white/55 sm:text-[17px]">
            Cloud workspaces that pick up where your laptop stops.
          </p>
        </div>

        <div className="grid gap-px bg-white/[0.06] md:grid-cols-3">
          {capabilities.map((item, idx) => (
            <div
              key={idx}
              className="group bg-background p-5 transition-colors hover:bg-card sm:p-7"
            >
              <div className="mb-6 flex items-center justify-between">
                <span className="marker">
                  <span className="text-white/55">01.{idx + 1}</span>
                </span>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-white/40 transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                  <item.icon className="h-4 w-4" />
                </span>
              </div>

              <h3 className="text-[15.5px] font-medium leading-snug text-white/90">{item.title}</h3>

              <div className="my-4 h-px bg-white/[0.06]" />

              <p className="text-[13.5px] leading-relaxed text-white/55">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
