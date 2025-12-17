"use client"

import { useQuery } from "@tanstack/react-query"
import { trpc } from "@/utils/trpc"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDistanceToNow } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Clock, GitBranch } from "lucide-react"

export function UsageHistory() {
  const { data, isLoading } = useQuery(trpc.workspace.listWorkspaces.queryOptions())

  if (isLoading) {
    return null
  }

  const workspaces = data?.workspaces || []

  const activeWorkspaces = workspaces.filter((ws) => ws.status !== "terminated")
  const terminatedWorkspaces = workspaces.filter((ws) => ws.status === "terminated")

  const WorkspaceTable = ({ workspaces, emptyMessage }: { workspaces: any[]; emptyMessage: string }) => {
    if (workspaces.length === 0) {
      return (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">{emptyMessage}</p>
        </div>
      )
    }

    return (
      <div className="space-y-3">
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className="flex items-center justify-between p-4 rounded-lg border border-border/50 bg-secondary/20 hover:border-accent/30 transition-colors"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="font-medium">{ws.subdomain}</p>
                <StatusBadge status={ws.status} />
              </div>
              {ws.repositoryUrl && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <GitBranch className="h-3 w-3" />
                  <span className="font-mono">
                    {ws.repositoryUrl?.replace("https://github.com/", "") || "No repository"}
                  </span>
                </div>
              )}
            </div>
            <div className="text-right text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-1.5 justify-end">
                <Clock className="h-3 w-3" />
                <span>Started {formatDistanceToNow(new Date(ws.startedAt), { addSuffix: true })}</span>
              </div>
              {ws.stoppedAt && <p>Stopped {formatDistanceToNow(new Date(ws.stoppedAt), { addSuffix: true })}</p>}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader>
        <CardTitle className="text-base">Workspace History</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="active" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-secondary/30 p-1">
            <TabsTrigger value="active" className="data-[state=active]:bg-card data-[state=active]:text-foreground">
              Active ({activeWorkspaces.length})
            </TabsTrigger>
            <TabsTrigger value="terminated" className="data-[state=active]:bg-card data-[state=active]:text-foreground">
              Terminated ({terminatedWorkspaces.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4">
            <WorkspaceTable workspaces={activeWorkspaces} emptyMessage="No active workspaces" />
          </TabsContent>

          <TabsContent value="terminated" className="mt-4">
            <WorkspaceTable workspaces={terminatedWorkspaces} emptyMessage="No terminated workspaces" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { className: string; label: string }> = {
    running: {
      className: "bg-accent/10 text-accent border-accent/20 hover:bg-accent/20",
      label: "Running",
    },
    pending: {
      className: "bg-secondary text-secondary-foreground border-border/50",
      label: "Pending",
    },
    stopped: {
      className: "bg-secondary text-muted-foreground border-border/50",
      label: "Stopped",
    },
    terminated: {
      className: "bg-destructive/10 text-destructive border-destructive/20",
      label: "Terminated",
    },
  }

  const variant = variants[status] || { className: "", label: status }

  return <Badge className={variant.className}>{variant.label}</Badge>
}
