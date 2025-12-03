"use client";

import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";

export function UsageHistory() {
  const { data, isLoading } = useQuery(trpc.workspace.listWorkspaces.queryOptions());

  if (isLoading) {
    return null; // Handled by Suspense
  }

  const workspaces = data?.workspaces || [];
  
  // Separate active and terminated
  const activeWorkspaces = workspaces.filter(
    (ws) => ws.status !== "terminated"
  );
  const terminatedWorkspaces = workspaces.filter(
    (ws) => ws.status === "terminated"
  );

  const WorkspaceTable = ({ workspaces, emptyMessage }: { workspaces: any[]; emptyMessage: string }) => {
    if (workspaces.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          {emptyMessage}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className="flex items-center justify-between p-4 border rounded-lg"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="font-medium">{ws.subdomain}</p>
                <StatusBadge status={ws.status} />
              </div>
              <p className="text-sm text-muted-foreground">
                {ws.repositoryUrl?.replace("https://github.com/", "") || "No repository"}
              </p>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <p>
                Started {formatDistanceToNow(new Date(ws.startedAt), { addSuffix: true })}
              </p>
              {ws.stoppedAt && (
                <p>
                  Stopped {formatDistanceToNow(new Date(ws.stoppedAt), { addSuffix: true })}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace History</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="active" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">
              Active ({activeWorkspaces.length})
            </TabsTrigger>
            <TabsTrigger value="terminated">
              Terminated ({terminatedWorkspaces.length})
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="active" className="mt-4">
            <WorkspaceTable
              workspaces={activeWorkspaces}
              emptyMessage="No active workspaces"
            />
          </TabsContent>
          
          <TabsContent value="terminated" className="mt-4">
            <WorkspaceTable
              workspaces={terminatedWorkspaces}
              emptyMessage="No terminated workspaces"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { className: string; label: string }> = {
    running: { className: "bg-green-500/15 text-green-600 hover:bg-green-500/25 border-green-500/20", label: "Running" },
    pending: { className: "bg-yellow-500/15 text-yellow-600 hover:bg-yellow-500/25 border-yellow-500/20", label: "Pending" },
    stopped: { className: "bg-gray-500/15 text-gray-600 hover:bg-gray-500/25 border-gray-500/20", label: "Stopped" },
    terminated: { className: "bg-red-500/15 text-red-600 hover:bg-red-500/25 border-red-500/20", label: "Terminated" },
  };

  const variant = variants[status] || { className: "", label: status };

  return (
    <Badge className={variant.className}>
      {variant.label}
    </Badge>
  );
}

