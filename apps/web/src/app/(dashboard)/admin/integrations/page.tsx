"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { SettingsGroup } from "@/components/dashboard/settings/settings-page";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
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
    <div className="flex items-center gap-4 py-4">
      <Skeleton className="h-10 w-10 rounded-xl bg-fill-2" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-28 rounded-md bg-fill-2" />
          <Skeleton className="h-5 w-20 rounded-full bg-fill" />
        </div>
        <Skeleton className="h-4 w-64 rounded-md bg-fill" />
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
    ></DashboardHeader>
  );

  if (sessionPending || !isAdmin || isPending) {
    return (
      <DashboardShell>
        {header}
        <SettingsGroup bodyClassName="divide-y divide-line py-1">
          {[...Array(4)].map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </SettingsGroup>
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
      <div className="space-y-6">
        {error ? (
          <p role="alert" className="text-[14px] text-destructive">
            Couldn’t load integrations: {error.message}
          </p>
        ) : null}

        {[...grouped.entries()].map(([category, items]) => (
          <SettingsGroup
            key={category}
            title={CATEGORY_LABEL[category] ?? category}
            bodyClassName="pt-1 pb-2"
          >
            <ul className="divide-y divide-line">
              {items.map((item) => {
                const meta = INTEGRATION_META[item.key as IntegrationKey];
                const status = integrationStatus(item, data!);
                const body = (
                  <div className="flex items-center gap-4 py-4">
                    <IntegrationLogo meta={meta} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-[14.5px] font-medium text-fg">{item.name}</h4>
                        <StatusBadge status={status} />
                      </div>
                      <p className="truncate text-[13px] text-fg-3">{meta.summary}</p>
                    </div>
                    {item.ready ? (
                      <span className="hidden items-center gap-1 text-[13px] text-fg-3 transition-colors group-hover:text-fg sm:flex">
                        Configure
                        <ChevronRight className="h-4 w-4" />
                      </span>
                    ) : null}
                  </div>
                );
                return (
                  <li key={item.key}>
                    {item.ready ? (
                      <Link
                        href={`/admin/integrations/${item.key}` as Route}
                        className="group -mx-2 block rounded-xl px-2 transition-colors hover:bg-fill focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="opacity-70">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </SettingsGroup>
        ))}
      </div>
    </DashboardShell>
  );
}
