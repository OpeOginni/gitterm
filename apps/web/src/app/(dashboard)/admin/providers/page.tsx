"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Globe, KeyRound } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import type { Route } from "next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";

export default function ProvidersPage() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: providers, isLoading } = useQuery({
    queryKey: ["admin", "providers"],
    queryFn: () => trpcClient.admin.infrastructure.listProviders.query(),
  });

  useEffect(() => {
    if (!isSessionPending) {
      if (!session?.user) {
        router.push("/login");
        return;
      }
      const userRole = (session.user as any)?.role;
      if (userRole !== "admin") {
        router.push("/dashboard");
        return;
      }
    }
  }, [session?.user, isSessionPending]);

  const [newProviderName, setNewProviderName] = useState("");
  const createProvider = useMutation({
    mutationFn: (name: string) => trpcClient.admin.infrastructure.createProvider.mutate({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      setIsCreateOpen(false);
      setNewProviderName("");
      toast.success("Provider created");
    },
    onError: (error) => toast.error(error.message),
  });

  // Don't render content if not authenticated or not admin (will redirect)
  if (isSessionPending || !session?.user || (session.user as any)?.role !== "admin") {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Skeleton className="h-8 w-48" />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Cloud Providers"
        text="Manage cloud providers and their regions. Disabled items won't appear in workspace creation."
      >
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={"/admin" as Route}>Back to Admin</Link>
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Provider
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Cloud Provider</DialogTitle>
                <DialogDescription>
                  Create a new cloud provider (e.g., Railway, AWS, Local).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Provider Name</Label>
                  <Input
                    id="name"
                    value={newProviderName}
                    onChange={(e) => setNewProviderName(e.target.value)}
                    placeholder="e.g., Railway"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => createProvider.mutate(newProviderName)}
                  disabled={!newProviderName || createProvider.isPending}
                >
                  {createProvider.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </DashboardHeader>

      <div className="pt-8 space-y-8">
        {isLoading ? (
          <div className="space-y-6">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {providers?.map((provider) => (
              <Link
                key={provider.id}
                href={`/admin/providers/${provider.id}` as Route}
                className={`group block rounded-xl border border-border/70 bg-background/40 p-5 shadow-sm transition-all hover:border-primary/50 hover:bg-background/70 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 rounded-md bg-muted/40 p-2 transition-colors group-hover:bg-muted/60">
                      <Globe className="h-5 w-5 text-muted-foreground/70" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-foreground/90">{provider.name}</h3>
                        {!provider.isEnabled && (
                          <Badge variant="secondary" className="text-xs">
                            Disabled
                          </Badge>
                        )}
                        {!provider.providerConfig && (
                          <Badge
                            variant="outline"
                            className="text-xs text-amber-500 border-amber-200/70 bg-amber-500/10"
                          >
                            Missing Config
                          </Badge>
                        )}
                        {provider.providerConfig && !provider.providerConfig.isEnabled && (
                          <Badge
                            variant="outline"
                            className="text-xs border-border/70 text-muted-foreground"
                          >
                            Config Disabled
                          </Badge>
                        )}
                        {provider.providerConfig && provider.providerConfig.isEnabled && (
                          <Badge
                            variant="outline"
                            className="text-xs border-emerald-500/50 text-emerald-500 bg-emerald-500/10"
                          >
                            Configured
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground/80">
                        {provider.regions.length} region{provider.regions.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground/80 group-hover:text-foreground/80">
                    <KeyRound className="h-4 w-4" />
                    <span>Provider Settings</span>
                  </div>
                </div>
              </Link>
            ))}

            {providers?.length === 0 && (
              <div className="py-12 text-center text-muted-foreground">
                No cloud providers configured yet. Run the seed script to add defaults.
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
