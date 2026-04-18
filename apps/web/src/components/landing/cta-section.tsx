import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function CTASection() {
  return (
    <section className="border-t border-border py-24 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="grid items-end gap-12 lg:grid-cols-[1fr_auto]">
          {/* Left: copy + CTAs */}
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
              Take OpenCode from local to cloud.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">
              Same config, persistent state, any device. Start free or deploy on your own
              infrastructure.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
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
                  variant="ghost"
                  size="lg"
                  className="h-12 px-6 text-sm text-muted-foreground hover:text-foreground"
                >
                  View Source
                </Button>
              </Link>
            </div>
          </div>

          {/* Right: self-host option */}
          <div className="hidden lg:block lg:pb-2">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
              Self-host
            </p>
            <Link
              href="https://railway.com/deploy/gitterm?referralCode=o9MFOP&utm_medium=integration&utm_source=template&utm_campaign=generic"
              target="_blank"
            >
              <img
                src="https://railway.com/button.svg"
                alt="Deploy on Railway"
                className="opacity-60 transition-opacity hover:opacity-100"
                height={28}
              />
            </Link>
          </div>
        </div>

        {/* Mobile: self-host below */}
        <div className="mt-10 border-t border-border pt-8 lg:hidden">
          <div className="flex items-center gap-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
              Self-host
            </span>
            <Link
              href="https://railway.com/deploy/gitterm?referralCode=o9MFOP&utm_medium=integration&utm_source=template&utm_campaign=generic"
              target="_blank"
            >
              <img
                src="https://railway.com/button.svg"
                alt="Deploy on Railway"
                className="opacity-60 transition-opacity hover:opacity-100"
                height={28}
              />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
