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
  { src: "/E2B.svg", label: "E2B" },
  { src: "/daytona.svg", label: "Daytona" },
];

const editorProviders = [
  { src: "/vscode.svg", label: "VS Code" },
  { src: "/cursor.svg", label: "Cursor" },
  { src: "/zed.svg", label: "Zed" },
  { src: "/neovim.svg", label: "NeoVim" },
];

export function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-36 pb-24 md:pt-44 md:pb-32">
      <div className="mx-auto max-w-[1120px] px-6">
        {/* Eyebrow */}
        <div className="mb-6 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/6 bg-white/3 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
            Cloud workspaces for OpenCode
          </span>
        </div>

        {/* Headline */}
        <h1 className="mx-auto max-w-4xl text-center text-[clamp(2.25rem,5vw,4.5rem)] font-bold leading-[1.08] tracking-tight text-white">
          Run OpenCode <span className="text-primary">anywhere.</span>
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
          workspaces in seconds. Persistent state, single config, any cloud/sandbox provider.
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
          <Link href="https://x.com/BrightOginni/status/2024206364906512436" target="_blank">
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
          {/* Infra */}
          <div className="mt-8 border-t border-white/[0.06] pt-8">
            <p className="mb-5 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-white/30">
              Run Workspaces on
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

          {/* Editors */}
          <div className="mt-8 border-t border-white/[0.06] pt-8">
            <p className="mb-5 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-white/30">
              Connect To your editor
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
              {editorProviders.map((e) => (
                <div
                  key={e.label}
                  className="flex items-center gap-2.5 text-white/50 transition-colors hover:text-white/80"
                >
                  <Image
                    src={e.src}
                    alt={e.label}
                    width={24}
                    height={24}
                    className="h-6 w-6 opacity-70"
                  />
                  <span className="text-sm font-medium">{e.label}</span>
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
