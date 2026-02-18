import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function CTASection() {
  return (
    <section className="border-t border-white/[0.06] py-24 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center md:px-16 md:py-20">
          {/* Subtle glow inside the card */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-24 left-1/2 h-[300px] w-[500px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(200,164,78,0.06),transparent)]" />
          </div>

          <div className="relative">
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-primary/70">
              Get started
            </p>
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl text-balance">
              Start building with OpenCode in minutes.
            </h2>
            <p className="mx-auto mb-8 max-w-md text-base text-white/50">
              Free tier included. No credit card required.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/dashboard">
                <Button
                  size="lg"
                  className="h-12 bg-primary px-8 font-mono text-sm font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
                >
                  Get Started Free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="https://github.com/OpeOginni/gitterm" target="_blank">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 border-white/[0.08] bg-transparent px-6 font-mono text-sm uppercase tracking-wider text-white/60 hover:border-white/20 hover:text-white/90"
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
