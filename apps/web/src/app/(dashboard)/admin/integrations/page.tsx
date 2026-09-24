"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ChevronRight, Settings2 } from "lucide-react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { INTEGRATION_META, type IntegrationKey } from "./_components/meta";
import { IntegrationLogo, StatusBadge } from "./_components/ui";
import {
  useAdminIntegrations,
  type AdminIntegrationsData,
} from "./_components/use-admin-integrations";

const CATEGORY_LABEL: Record<string, string> = {
  git: "Source control",
  cloud: "Cloud",
  mcp: "Agents & MCP",
};

function integrationStatus(
  item: AdminIntegrationsData["integrations"][number],
  data: AdminIntegrationsData,
) {
  if (!item.ready) return "planned" as const;
  if (item.enabled) return "enabled" as const;
  const configured =
    item.key === "github" ? !!data.githubMode : item.key === "google" ? !!data.google : true;
  return configured ? ("disabled" as const) : ("unconfigured" as const);
}

function RowSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-4">
        <Skeleton className="h-11 w-11 rounded-xl bg-foreground/[0.08]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-28 rounded-md bg-foreground/[0.08]" />
            <Skeleton className="h-5 w-20 rounded-full bg-foreground/[0.07]" />
          </div>
          <Skeleton className="h-4 w-64 rounded-md bg-foreground/[0.06]" />
        </div>
      </div>
    </div>
  );
}

export default function AdminIntegrationsPage() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";
  const { data, isPending, error } = useAdminIntegrations(isAdmin);

  useEffect(() => {
    if (sessionPending) return;
    if (!session?.user) router.push("/login");
    else if (!isAdmin) router.push("/dashboard");
  }, [session?.user, sessionPending, isAdmin, router]);

  const header = (
    <DashboardHeader
      heading="Integrations"
      text="Control which connections users can set up across this deployment."
    >
      <Button asChild variant="outline">
        <Link
          href={"/admin" as Route}
          className="font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          Back to Admin
        </Link>
      </Button>
    </DashboardHeader>
  );

  if (sessionPending || !isAdmin || isPending) {
    return (
      <DashboardShell>
        {header}
        <div className="space-y-2 pt-2">
          {[...Array(4)].map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      </DashboardShell>
    );
  }

  const grouped = new Map<string, AdminIntegrationsData["integrations"]>();
  for (const item of data?.integrations ?? []) {
    grouped.set(item.category, [...(grouped.get(item.category) ?? []), item]);
  }

  return (
    <DashboardShell>
      {header}
      <div className="space-y-8 pt-2">
        {error ? (
          <p role="alert" className="text-sm text-red-400">
            Couldn’t load integrations: {error.message}
          </p>
        ) : null}

        {[...grouped.entries()].map(([category, items]) => (
          <section key={category} className="space-y-2">
            <p className="px-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {CATEGORY_LABEL[category] ?? category}
            </p>
            <ul className="space-y-2">
              {items.map((item) => {
                const meta = INTEGRATION_META[item.key as IntegrationKey];
                const status = integrationStatus(item, data!);
                const body = (
                  <div className="flex items-center gap-4">
                    <IntegrationLogo meta={meta} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-foreground/90">{item.name}</h3>
                        <StatusBadge status={status} />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{meta.summary}</p>
                    </div>
                    {item.ready ? (
                      <div className="hidden items-center gap-2 text-xs text-muted-foreground transition-colors group-hover:text-foreground/70 sm:flex">
                        <Settings2 className="h-3.5 w-3.5" />
                        <span className="font-mono uppercase tracking-[0.18em]">Configure</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </div>
                    ) : null}
                  </div>
                );
                return (
                  <li key={item.key}>
                    {item.ready ? (
                      <Link
                        href={`/admin/integrations/${item.key}` as Route}
                        className="group relative block overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all hover:border-amber-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-amber-500/[0.05] opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-100" />
                        {body}
                      </Link>
                    ) : (
                      <div
                        className={cn(
                          "rounded-2xl border border-dashed border-border bg-card/40 p-5 opacity-70",
                        )}
                      >
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </DashboardShell>
  );
}
