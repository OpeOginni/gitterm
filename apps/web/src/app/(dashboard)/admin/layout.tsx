"use client"

import type React from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { data: session, isPending } = authClient.useSession()
  const router = useRouter()

  // Show loading while checking session
  if (isPending) {
    return (
      <div className="flex-1 p-6 md:p-8 lg:p-10">
        <div className="mx-auto max-w-7xl space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  // Check if user is admin
  const userRole = (session?.user as any)?.role
  if (!session?.user || userRole !== "admin") {
    router.push("/dashboard")
    return null
  }

  return <>{children}</>
}
