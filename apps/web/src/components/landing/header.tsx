"use client"

import Link from "next/link"
import type { Route } from "next"
import { Button } from "@/components/ui/button"
import { Terminal } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { isBillingEnabled } from "@gitterm/env/web"

export function LandingHeader() {
  const { data: session } = authClient.useSession()
  const showPricing = isBillingEnabled()

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <Terminal className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold text-foreground">GitTerm</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <Link href="#features" className="text-sm text-muted-foreground transition-colors hover:text-primary">
            Features
          </Link>
          <Link href="#how-it-works" className="text-sm text-muted-foreground transition-colors hover:text-primary">
            How it Works
          </Link>
          {showPricing && (
            <Link href={"/pricing" as Route} className="text-sm text-muted-foreground transition-colors hover:text-primary">
              Pricing
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {session ? (
            <Link href="/dashboard">
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
                Dashboard
              </Button>
            </Link>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                  Log in
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground">
                  Get Started
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
