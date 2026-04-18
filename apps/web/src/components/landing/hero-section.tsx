import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

const providers = [
  { src: "/railway.svg", label: "Railway" },
  { src: "/E2B.svg", label: "E2B" },
  { src: "/daytona.svg", label: "Daytona" },
  { src: "/cloudflare.svg", label: "Cloudflare" },
];

const editors = [
  { src: "/vscode.svg", label: "VS Code" },
  { src: "/cursor.svg", label: "Cursor" },
  { src: "/zed.svg", label: "Zed" },
  { src: "/neovim.svg", label: "Neovim" },
];

export function HeroSection() {
  return (
    <section className="relative pt-32 pb-20 md:pt-44 md:pb-28">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="grid items-center gap-16 lg:grid-cols-[1.2fr_1fr]">
          {/* Left: headline + sub + CTAs */}
          <div>
            <h1 className="max-w-[620px] text-[clamp(2.5rem,5.5vw,4.75rem)] font-bold leading-[1.05] tracking-tight text-foreground">
              Run OpenCode
              <br />
              <span className="text-primary">in the cloud.</span>
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Cloud workspaces for{" "}
              <Link
                href="https://opencode.ai/"
                target="_blank"
                className="text-foreground underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary"
              >
                OpenCode
              </Link>
              . Persistent state, your config, any provider. Launch in seconds, resume from
              anywhere.
            </p>

            <div className="mt-10 flex items-center gap-4">
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
                  variant="ghost"
                  className="h-12 px-6 text-sm text-muted-foreground hover:text-foreground"
                >
                  Watch Demo
                  <ArrowUpRight className="ml-1.5 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>

          {/* Right: providers + editors, horizontal rows, large logos */}
          <div className="hidden flex-col gap-8 lg:flex">
            {/* Providers */}
            <div>
              <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
                Deploy on
              </p>
              <div className="flex flex-wrap items-center gap-6">
                {providers.map((p) => (
                  <div
                    key={p.label}
                    className="group flex items-center gap-2.5 transition-colors"
                  >
                    <Image
                      src={p.src}
                      alt={p.label}
                      width={22}
                      height={22}
                      className="h-[22px] w-[22px] opacity-50 transition-opacity group-hover:opacity-100"
                    />
                    <span className="text-sm text-muted-foreground transition-colors group-hover:text-foreground">
                      {p.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Editors */}
            <div>
              <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
                Connect your editor
              </p>
              <div className="flex flex-wrap items-center gap-6">
                {editors.map((e) => (
                  <div
                    key={e.label}
                    className="group flex items-center gap-2.5 transition-colors"
                  >
                    <Image
                      src={e.src}
                      alt={e.label}
                      width={22}
                      height={22}
                      className="h-[22px] w-[22px] opacity-50 transition-opacity group-hover:opacity-100"
                    />
                    <span className="text-sm text-muted-foreground transition-colors group-hover:text-foreground">
                      {e.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Mobile: logos below */}
        <div className="mt-14 flex flex-col gap-8 lg:hidden">
          <div>
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground/50">
              Deploy on
            </p>
            <div className="flex flex-wrap items-center gap-6">
              {providers.map((p) => (
                <div key={p.label} className="flex items-center gap-2.5">
                  <Image
                    src={p.src}
                    alt={p.label}
                    width={24}
                    height={24}
                    className="h-6 w-6 opacity-50"
                  />
                  <span className="text-sm text-muted-foreground">{p.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground/50">
              Connect your editor
            </p>
            <div className="flex flex-wrap items-center gap-6">
              {editors.map((e) => (
                <div key={e.label} className="flex items-center gap-2.5">
                  <Image
                    src={e.src}
                    alt={e.label}
                    width={24}
                    height={24}
                    className="h-6 w-6 opacity-50"
                  />
                  <span className="text-sm text-muted-foreground">{e.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
