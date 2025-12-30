import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

export function CTASection() {
  return (
    <section className="border-t border-border py-20 md:py-32">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl text-balance">
          Ready to code from anywhere?
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-lg text-muted-foreground">
          Start with our free tier. No credit card required. 
          Get daily minutes to run your cloud workspaces.
        </p>
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link href="/dashboard">
            <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90">
              Get Started for Free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <Link href="https://github.com/OpeOginni/gitterm" target="_blank">
            <Button
              variant="outline"
              size="lg"
              className="border-border text-foreground hover:bg-secondary bg-transparent"
            >
              Source Code
            </Button>
          </Link>
        </div>
        <div className="mt-6">
          <p className="text-sm text-muted-foreground mb-3">Or deploy your own instance</p>
          <Link 
            href="https://railway.com/deploy/gitterm?referralCode=o9MFOP&utm_medium=integration&utm_source=template&utm_campaign=generic"
            target="_blank"
          >
            <img src="https://railway.com/button.svg" alt="Deploy on Railway" className="mx-auto" height={32} />
          </Link>
        </div>
      </div>
    </section>
  )
}
