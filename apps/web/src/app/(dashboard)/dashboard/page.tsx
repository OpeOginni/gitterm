import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell"
import { InstanceList } from "@/components/dashboard/instance-list"
import { CreateInstanceDialog } from "@/components/dashboard/create-instance-dialog"
import { authClient } from "@/lib/auth-client"
import { redirect } from "next/navigation"
import { headers } from "next/headers"

export default async function DashboardPage() {
  const session = await authClient.getSession({
    fetchOptions:{
      headers: await headers()
    }
  })

  if(!session.data?.user) {
    redirect("/login")
  }

  return (
    <DashboardShell>
      <DashboardHeader heading="Workspaces" text="Create and manage your remote development environments.">
        <CreateInstanceDialog />
      </DashboardHeader>
      <div className="grid gap-8 pt-8">
        <InstanceList />
      </div>
    </DashboardShell>
  )
}
