import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowUpRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

const modelProviders = [
  { src: "/openai.svg", label: "OpenAI" },
  { src: "/anthropic.svg", label: "Anthropic" },
  { src: "/opencode-zen.svg", label: "Zen" },
  { src: "/github-copilot.svg", label: "Copilot" },
];

const infraProviders = [
  { src: "/railway.svg", label: "Railway" },
  { src: "/cloudflare.svg", label: "Cloudflare" },
  { src: "/EC2.svg", label: "AWS EC2" },
];

export function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-36 pb-24 md:pt-44 md:pb-32">
      <div className="mx-auto max-w-[1120px] px-6">
        {/* Eyebrow */}
        <div className="mb-6 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            Cloud workspaces for OpenCode
          </span>
        </div>

        {/* Headline */}
        <h1 className="mx-auto max-w-4xl text-center text-[clamp(2.25rem,5vw,4.5rem)] font-bold leading-[1.08] tracking-tight text-white">
          Run OpenCode{" "}
          <span className="text-primary">anywhere.</span>
        </h1>

        {/* Sub */}
        <p className="mx-auto mt-6 max-w-xl text-center text-base leading-relaxed text-white/50 sm:text-lg">
          Launch cloud-hosted{" "}
          <Link
            href="https://opencode.ai/"
            target="_blank"
            className="text-white/70 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white hover:decoration-white/50"
          >
            OpenCode
          </Link>{" "}
          workspaces in seconds. Persistent state, agentic loops, and zero config.
        </p>

        {/* CTA row */}
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href="/dashboard">
            <Button
              size="lg"
              className="h-12 bg-primary px-8 font-mono text-sm font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
            >
              Start Building
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <Link
            href="https://x.com/BrightOginni/status/2024206364906512436"
            target="_blank"
          >
            <Button
              size="lg"
              variant="outline"
              className="h-12 border-white/[0.08] bg-transparent px-6 font-mono text-sm uppercase tracking-wider text-white/60 hover:border-white/20 hover:text-white/90"
            >
              <ArrowUpRight className="mr-2 h-4 w-4" />
              Watch Demo
            </Button>
          </Link>
        </div>

        {/* Logo bands */}
        <div className="mx-auto mt-20 max-w-3xl">
          {/* Model providers */}
          <div className="border-t border-white/[0.06] pt-8">
            <p className="mb-5 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-white/30">
              Model providers
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
              {modelProviders.map((p) => (
                <div
                  key={p.label}
                  className="flex items-center gap-2.5 text-white/50 transition-colors hover:text-white/80"
                >
                  <Image
                    src={p.src}
                    alt={p.label}
                    width={24}
                    height={24}
                    className="h-6 w-6 opacity-70"
                  />
                  <span className="text-sm font-medium">{p.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Infra */}
          <div className="mt-8 border-t border-white/[0.06] pt-8">
            <p className="mb-5 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-white/30">
              Deploy on
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
              {infraProviders.map((i) => (
                <div
                  key={i.label}
                  className="flex items-center gap-2.5 text-white/50 transition-colors hover:text-white/80"
                >
                  <Image
                    src={i.src}
                    alt={i.label}
                    width={24}
                    height={24}
                    className="h-6 w-6 opacity-70"
                  />
                  <span className="text-sm font-medium">{i.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Scroll hint */}
        <div className="mt-16 flex flex-col items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/20">
            Scroll
          </span>
          <ChevronDown className="h-4 w-4 animate-bounce text-white/20" />
        </div>
      </div>
    </section>
  );
}
