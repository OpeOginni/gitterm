import { Button } from "@/components/ui/button"
import { ArrowRight, Play } from "lucide-react"
import { TerminalDemo } from "@/components/landing/terminal-demo"
import Link from "next/link"

export function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 md:pt-40 md:pb-32">
      {/* Glow effect */}
      <div className="absolute left-1/2 top-0 -z-10 -translate-x-1/2 h-[400px] w-[600px] rounded-full bg-primary/10 blur-[120px]" />
      
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-8 items-center">
          <div className="flex flex-col gap-6">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-secondary/10 px-4 py-1.5 text-sm text-muted-foreground">
              <span className="h-2 w-2 bg-emerald-300 rounded-full animate-pulse" />
              Now in Public Beta
            </div>

            <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground md:text-5xl lg:text-6xl text-balance">
              Remote workspaces for
              <br />
              <span className="text-muted-foreground">AI coding agents.</span>
            </h1>

            <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
              Spin up cloud-hosted OpenCode environments in seconds. 
              Or tunnel your local setup through secure, shareable URLs. 
              Code from any device, anywhere, with temporary or persisted workspaces.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/dashboard">
                <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Start Building
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="https://github.com/opeoginni/gitterm" target="_blank">
                <Button variant="ghost" size="lg" className="text-muted-foreground hover:text-foreground">
                  <Play className="mr-2 h-4 w-4" />
                  View on GitHub
                </Button>
              </Link>
            </div>
          </div>

          <div className="relative">
            <TerminalDemo />
          </div>
        </div>
      </div>
    </section>
  )
}
