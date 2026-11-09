"use client";

import Link from "next/link";
import type { Route } from "next";
import { ChevronRight } from "lucide-react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Panel, PanelRow, SectionHeading } from "@/components/dashboard/kit";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminGuard } from "../_components/admin";
import { INTEGRATION_META, type IntegrationKey } from "./_components/meta";
import { IntegrationLogo, StatusBadge } from "./_components/ui";
import {
  integrationStatus,
  useAdminIntegrations,
  type AdminIntegrationsData,
} from "./_components/use-admin-integrations";

const CATEGORY_LABEL: Record<string, string> = {
  git: "Source control",
  cloud: "Cloud",
  mcp: "Agents and MCP",
};

// The groups as they load: each category with the number of integrations it holds.
const LOADING_GROUPS: Array<[keyof typeof CATEGORY_LABEL, number]> = [
  ["git", 3],
  ["cloud", 1],
  ["mcp", 2],
];

export default function AdminIntegrationsPage() {
  const { ready } = useAdminGuard();
  const { data, isPending, error } = useAdminIntegrations(ready);

  const header = (
    <DashboardHeader
      heading="Integrations"
      text="Choose which connections users can set up on this deployment."
    />
  );

  if (!ready || isPending) {
    return (
      <DashboardShell>
        {header}
        <div className="space-y-12">
          {LOADING_GROUPS.map(([category, rows]) => (
            <section key={category} className="space-y-4">
              <SectionHeading title={CATEGORY_LABEL[category]} />
              <Panel>
                {Array.from({ length: rows }, (_, i) => (
                  <PanelRow key={i}>
                    <Skeleton className="size-9 shrink-0 rounded-lg bg-fill-2" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-28 bg-fill-2" />
                      <Skeleton className="h-3.5 w-64 max-w-full bg-fill-2" />
                    </div>
                    <Skeleton className="h-4 w-20 shrink-0 bg-fill-2" />
                  </PanelRow>
                ))}
              </Panel>
            </section>
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
      <div className="space-y-12">
        {error ? (
          <p role="alert" className="text-[14px] text-destructive">
            Couldn&apos;t load integrations: {error.message}
          </p>
        ) : null}

        {[...grouped.entries()].map(([category, items]) => (
          <section key={category} className="space-y-4">
            <SectionHeading title={CATEGORY_LABEL[category] ?? category} />
            <Panel>
              {items.map((item) => {
                const meta = INTEGRATION_META[item.key as IntegrationKey];
                const body = (
                  <>
                    <IntegrationLogo meta={meta} className={item.ready ? "" : "opacity-60"} />
                    <div className="min-w-0 flex-1">
                      <p
                        className={
                          item.ready
                            ? "text-[14px] font-medium text-fg"
                            : "text-[14px] font-medium text-fg-3"
                        }
                      >
                        {item.name}
                      </p>
                      <p className="mt-0.5 truncate text-[13px] text-fg-3">{meta.summary}</p>
                    </div>
                    <StatusBadge status={integrationStatus(item, data!)} />
                  </>
                );
                return item.ready ? (
                  <Link
                    key={item.key}
                    href={`/admin/integrations/${item.key}` as Route}
                    className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none sm:px-5"
                  >
                    {body}
                    <ChevronRight className="size-4 shrink-0 text-fg-4 transition-colors group-hover:text-fg" />
                  </Link>
                ) : (
                  <PanelRow key={item.key}>
                    {body}
                    <span className="size-4 shrink-0" />
                  </PanelRow>
                );
              })}
            </Panel>
          </section>
        ))}
      </div>
    </DashboardShell>
  );
}
