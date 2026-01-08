"use client";

import { useState } from "react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { Route } from "next";
import { Plus, Server } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";

export default function AgentTypesPage() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: "", serverOnly: false });

  const { data: agentTypes, isLoading } = useQuery({
    queryKey: ["admin", "agentTypes"],
    queryFn: () => trpcClient.admin.infrastructure.listAgentTypes.query(),
  });

  const createAgentType = useMutation({
    mutationFn: (params: { name: string; serverOnly: boolean }) =>
      trpcClient.admin.infrastructure.createAgentType.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "agentTypes"] });
      setIsCreateOpen(false);
      setNewAgent({ name: "", serverOnly: false });
      toast.success("Agent type created");
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleAgentType = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      trpcClient.admin.infrastructure.toggleAgentType.mutate({ id, isEnabled }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "agentTypes"] });
      toast.success(`Agent type ${data.isEnabled ? "enabled" : "disabled"}`);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Agent Types"
        text="Configure the types of agents available for workspaces. Disabled agents won't appear in workspace creation."
      >
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={"/admin" as Route}>Back to Admin</Link>
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Agent Type
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Agent Type</DialogTitle>
                <DialogDescription>
                  Create a new agent type that users can deploy.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Agent Name</Label>
                  <Input
                    id="name"
                    value={newAgent.name}
                    onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
                    placeholder="e.g., OpenCode"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="serverOnly"
                    checked={newAgent.serverOnly}
                    onCheckedChange={(checked) =>
                      setNewAgent({ ...newAgent, serverOnly: checked === true })
                    }
                  />
                  <Label htmlFor="serverOnly" className="text-sm font-normal">
                    Server-only mode (no terminal, API access only)
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => createAgentType.mutate(newAgent)}
                  disabled={!newAgent.name || createAgentType.isPending}
                >
                  {createAgentType.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </DashboardHeader>

      <div className="pt-8 space-y-6">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {agentTypes?.map((agent) => (
              <div
                key={agent.id}
                className={`flex items-center justify-between py-4 px-4 rounded-lg hover:bg-muted/40 transition-colors group ${!agent.isEnabled ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-md bg-muted/50">
                    <Server className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{agent.name}</span>
                      {!agent.isEnabled && (
                        <Badge variant="secondary" className="text-xs">
                          Disabled
                        </Badge>
                      )}
                      {agent.serverOnly ? (
                        <Badge variant="secondary" className="text-xs">
                          Server Only
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Terminal
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Created {new Date(agent.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={agent.isEnabled}
                  onCheckedChange={(checked) =>
                    toggleAgentType.mutate({ id: agent.id, isEnabled: checked })
                  }
                />
              </div>
            ))}

            {agentTypes?.length === 0 && (
              <div className="py-12 text-center text-muted-foreground">
                No agent types configured yet. Add one to get started.
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
