import { Button } from "@/components/ui/button";
import { ArrowRight, Star } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";

export function CTASection() {
  return (
    <section className="border-t border-white/[0.06] py-14 sm:py-20 md:py-28">
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-14 text-center sm:py-16 md:px-16 md:py-20">
          {/* Subtle glow inside the card */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-24 left-1/2 h-[300px] w-[500px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(200,164,78,0.06),transparent)]" />
          </div>

          <div className="relative">
            <div className="mb-5 flex items-center justify-center gap-3">
              <span className="h-px w-12 bg-white/[0.08]" />
              <span className="marker">Get started</span>
              <span className="h-px w-12 bg-white/[0.08]" />
            </div>

            <h2 className="mb-5 font-display text-[clamp(1.9rem,4.5vw,3.4rem)] font-light leading-[1.05] tracking-tight text-white text-balance">
              Your agents. Your cloud.{" "}
              <span className="font-display-italic text-[color:var(--cream)]">Your keys.</span>
            </h2>
            <p className="mx-auto mb-9 max-w-md text-base leading-[1.65] text-white/50">
              Use the hosted version, or run the whole thing on your own infra.
            </p>

            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/dashboard">
                <Button className="group h-11 bg-primary px-7 font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-primary-foreground hover:bg-primary/90">
                  Get started
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 ease-out group-hover:translate-x-1" />
                </Button>
              </Link>
              <Link href="https://github.com/OpeOginni/gitterm" target="_blank">
                <Button
                  variant="outline"
                  className="h-11 border-white/[0.1] bg-transparent px-6 font-mono text-[12px] uppercase tracking-[0.18em] text-white/60 hover:border-primary hover:text-white/90"
                >
                  <Star className="mr-2 h-3.5 w-3.5 text-primary" />
                  Star on GitHub
                </Button>
              </Link>
            </div>

            <div className="mt-10">
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.25em] text-white/30">
                Or run it on your own infra
              </p>
              <div className="flex flex-col items-center gap-2">
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
                <Link
                  href={"/self-host" as Route}
                  className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/35 underline decoration-white/15 underline-offset-4 transition-colors hover:text-white/70"
                >
                  Self-hosting guide
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
