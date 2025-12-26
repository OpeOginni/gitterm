"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { CheckCircle, XCircle, Shield, Loader2 } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { trpcClient } from "@/utils/trpc"

export default function DevicePage() {
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()
  const [userCode, setUserCode] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const normalized = useMemo(() => userCode.trim().toUpperCase(), [userCode])

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login?redirect=/device")
    }
  }, [session, isPending, router])

  async function submit(action: "approve" | "deny") {
    if (!normalized) {
      toast.error("Enter a code")
      return
    }

    setIsSubmitting(true)
    try {
      await trpcClient.device.approve.mutate({
        userCode: normalized,
        action,
      })

      toast.success(action === "approve" ? "Device approved" : "Device denied")
      setUserCode("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed"
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Show loading state while checking auth
  if (isPending || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* Main content */}
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <Card className="w-full max-w-md border-border/50">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Authorize Device</CardTitle>
            <CardDescription>
              Enter the code from your terminal to authorize this CLI session
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Code input */}
            <div className="space-y-2">
              <Label htmlFor="code">Authorization Code</Label>
              <Input
                id="code"
                placeholder="ABCD-EFGH"
                value={userCode}
                onChange={(e) => setUserCode(e.target.value)}
                autoCapitalize="characters"
                spellCheck={false}
                className="h-12 font-mono text-xl tracking-widest text-center"
                disabled={isSubmitting}
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button
                onClick={() => submit("approve")}
                disabled={isSubmitting || !normalized}
                className="flex-1"
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Approve
              </Button>
              <Button
                variant="outline"
                onClick={() => submit("deny")}
                disabled={isSubmitting || !normalized}
                className="flex-1 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
              >
                <XCircle className="mr-2 h-4 w-4" />
                Deny
              </Button>
            </div>

            {/* Security notice */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border/50">
              <Shield className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Only approve devices you personally control. This will grant access to your GitTerm workspaces.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-sm text-muted-foreground">
          Need help?{" "}
          <Link href="/" className="text-foreground hover:underline">
            Return to home
          </Link>
        </p>
      </footer>
    </div>
  )
}
