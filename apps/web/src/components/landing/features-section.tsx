import {
  Layers,
  KeyRound,
  MonitorSmartphone,
  Save,
  Globe,
  Share2,
  TerminalSquare,
} from "lucide-react";

const features = [
  { icon: Layers, title: "Pick your cloud." },
  { icon: KeyRound, title: "Set keys once." },
  { icon: MonitorSmartphone, title: "Use any device." },
  { icon: Save, title: "Never lose your work." },
  { icon: Globe, title: "Share a live preview of apps." },
  { icon: Share2, title: "Bring your team in." },
  { icon: TerminalSquare, title: "Automate with CLI or SDK." },
];

export function FeaturesSection() {
  return (
    <section id="features" className="border-t border-white/[0.06] py-14 sm:py-20 md:py-28">
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
        <div className="mx-auto mb-10 max-w-xl text-center sm:mx-0 sm:mb-12 sm:text-left">
          <h2 className="font-display text-[clamp(1.9rem,4vw,3.2rem)] font-light leading-[1.04] tracking-tight text-white">
            Built for how you actually{" "}
            <span className="font-display-accent text-[color:var(--cream)]">work</span>.
          </h2>
        </div>

        <div className="flex flex-wrap justify-center gap-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="flex w-full flex-row items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left transition-colors hover:border-white/[0.12] hover:bg-white/[0.04] min-[420px]:w-[calc(50%-8px)] min-[420px]:flex-col min-[420px]:items-center min-[420px]:p-5 min-[420px]:text-center sm:w-[calc(25%-12px)] sm:items-start sm:p-6 sm:text-left"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04]">
                <feature.icon className="h-[18px] w-[18px] text-primary/80" />
              </span>
              <h3 className="text-[14px] font-medium text-white/85 sm:text-[15px]">
                {feature.title}
              </h3>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
