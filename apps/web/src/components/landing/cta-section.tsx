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
              Get Started Free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <Link href="#">
            <Button
              variant="outline"
              size="lg"
              className="border-border text-foreground hover:bg-secondary bg-transparent"
            >
              Source on Github Coming soon...
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
