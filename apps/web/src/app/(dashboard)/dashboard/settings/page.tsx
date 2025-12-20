import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell"
import { DeleteAccountSection } from "@/components/dashboard/delete-account"
import { authClient } from "@/lib/auth-client"
import { redirect } from "next/navigation"
import { headers } from "next/headers"

export default async function SettingsPage() {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers()
    }
  })

  if (!session.data?.user) {
    redirect("/login")
  }

  return (
    <DashboardShell>
      <DashboardHeader 
        heading="Settings" 
        text="Manage your account settings and preferences." 
      />
      <div className="mx-auto max-w-2xl">
        <DeleteAccountSection />
      </div>
    </DashboardShell>
  )
}
