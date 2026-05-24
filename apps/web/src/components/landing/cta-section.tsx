import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";

export function CTASection() {
  return (
    <section className="border-t border-white/[0.06] py-24 md:py-32">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center md:px-16 md:py-20">
          {/* Subtle glow inside the card */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-24 left-1/2 h-[300px] w-[500px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(200,164,78,0.06),transparent)]" />
          </div>

          <div className="relative">
            <div className="mb-5 flex items-center justify-center gap-3">
              <span className="h-px w-12 bg-white/[0.08]" />
              <span className="marker">Try before you buy</span>
              <span className="h-px w-12 bg-white/[0.08]" />
            </div>

            <h2 className="mb-5 font-display text-3xl font-light leading-[1.05] tracking-tight text-white md:text-5xl text-balance">
              See it work in{" "}
              <span className="font-display-italic text-[color:var(--cream)]">10 seconds</span>.
            </h2>
            <p className="mx-auto mb-8 max-w-md text-base text-white/50">
              No signup. No credit card. Paste a public GitHub repo, pick OpenCode, and watch a real
              GitTerm workspace boot in a sandboxed E2B environment. You'll see the browser terminal
              come alive.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href={"/playground" as Route}>
                <Button
                  size="lg"
                  className="h-12 bg-primary px-8 font-mono text-sm font-bold uppercase tracking-[0.16em] text-primary-foreground hover:bg-primary/85"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Try Free · No Signup
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="https://github.com/OpeOginni/gitterm" target="_blank">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 border-white/[0.08] bg-transparent px-6 font-mono text-sm uppercase tracking-[0.16em] text-white/60 hover:border-white/20 hover:text-white/90"
                >
                  View Source
                </Button>
              </Link>
            </div>
            <div className="mt-8">
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.25em] text-white/30">
                Or deploy your own infra
              </p>
              <Link
                href="https://railway.com/deploy/gitterm?referralCode=o9MFOP&utm_medium=integration&utm_source=template&utm_campaign=generic"
                target="_blank"
              >
                <img
                  src="https://railway.com/button.svg"
                  alt="Deploy on Railway"
                  className="mx-auto opacity-80 transition-opacity hover:opacity-100"
                  height={32}
                />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
