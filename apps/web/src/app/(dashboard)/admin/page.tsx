"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import {
  Panel,
  PanelRow,
  SectionHeading,
  StatStrip,
  StatusDot,
  type Tone,
} from "@/components/dashboard/kit";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { trpcClient } from "@/utils/trpc";
import { providerStatus, timeAgo, useAdminGuard } from "./_components/admin";
import {
  integrationStatus,
  useAdminIntegrations,
} from "./integrations/_components/use-admin-integrations";

type Issue = { id: string; tone: Tone; title: string; detail: string; href: Route };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function LinkRow({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none sm:px-5"
    >
      {children}
      <ChevronRight className="size-4 shrink-0 text-fg-4 transition-colors group-hover:text-fg" />
    </Link>
  );
}

/** Rows shaped like the loaded ones: a title over a detail line, with an avatar for people. */
function RowsSkeleton({ rows = 3, avatar = false }: { rows?: number; avatar?: boolean }) {
  return (
    <Panel>
      {Array.from({ length: rows }, (_, i) => (
        <PanelRow key={i}>
          {avatar && <Skeleton className="size-8 shrink-0 rounded-full bg-fill-2" />}
          <div className="min-w-0 flex-1 space-y-2 py-0.5">
            <Skeleton className="h-4 w-1/2 bg-fill-2" />
            <Skeleton className="h-3 w-2/3 bg-fill-2" />
          </div>
        </PanelRow>
      ))}
    </Panel>
  );
}

/** Users by plan while the users load: one bar row per plan. */
function PlansSkeleton() {
  return (
    <Panel>
      {Array.from({ length: 4 }, (_, i) => (
        <PanelRow key={i} className="gap-4">
          <Skeleton className="h-4 w-16 shrink-0 bg-fill-2" />
          <Skeleton className="h-1.5 min-w-0 flex-1 rounded-full bg-fill-2" />
          <Skeleton className="h-5 w-8 shrink-0 bg-fill-2" />
        </PanelRow>
      ))}
    </Panel>
  );
}

export default function AdminPage() {
  const { ready } = useAdminGuard();

  const { data: stats } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => trpcClient.admin.users.stats.query(),
    enabled: ready,
  });
  // Newest first, so the head of the list is the recent sign-ups.
  const { data: users } = useQuery({
    queryKey: ["admin", "users", "overview"],
    queryFn: () => trpcClient.admin.users.list.query({ limit: 100 }),
    enabled: ready,
  });
  const { data: providers } = useQuery({
    queryKey: ["admin", "providers"],
    queryFn: () => trpcClient.admin.infrastructure.listProviders.query(),
    enabled: ready,
  });
  const { data: agentTypes } = useQuery({
    queryKey: ["admin", "agentTypes"],
    queryFn: () => trpcClient.admin.infrastructure.listAgentTypes.query(),
    enabled: ready,
  });
  const { data: images } = useQuery({
    queryKey: ["admin", "images"],
    queryFn: () => trpcClient.admin.infrastructure.listImages.query(),
    enabled: ready,
  });
  const { data: settings } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => trpcClient.admin.settings.get.query(),
    enabled: ready,
  });
  const { data: integrations } = useAdminIntegrations(ready);

  const readyProviders = (providers ?? []).filter(
    (provider) => providerStatus(provider).state === "ready",
  );
  // Unpriced sizes can't start, so check every provider users can reach.
  const profileQueries = useQueries({
    queries: readyProviders.map((provider) => ({
      queryKey: ["admin", "machineProfiles", provider.id],
      queryFn: () =>
        trpcClient.admin.infrastructure.listMachineProfiles.query({
          cloudProviderId: provider.id,
        }),
    })),
  });

  if (!ready) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Skeleton className="h-8 w-48 bg-fill" />
        </div>
      </DashboardShell>
    );
  }

  // Plans come with the user list. Until it arrives, lay out the page as billing deployments do.
  const billing = users ? users.plans.length > 0 : true;
  const enabledProviders = (providers ?? []).filter((provider) => provider.isEnabled);

  const issues: Issue[] = [];
  for (const provider of enabledProviders) {
    const status = providerStatus(provider);
    if (status.state !== "setup") continue;
    issues.push({
      id: `provider-${provider.id}`,
      tone: "warn",
      title: provider.providerConfig
        ? `${provider.name}'s credentials are turned off`
        : `${provider.name} has no credentials`,
      detail: "Enabled, but workspaces can't start there.",
      href: `/admin/providers/${provider.id}` as Route,
    });
  }
  readyProviders.forEach((provider, index) => {
    const data = profileQueries[index]?.data;
    if (!data?.billingEnabled) return;
    const unpriced = data.profiles.filter(
      (profile) => profile.isEnabled && profile.priceMicrosPerHour === null,
    );
    if (unpriced.length === 0) return;
    issues.push({
      id: `price-${provider.id}`,
      tone: "warn",
      title: `${provider.name} has ${plural(unpriced.length, "size")} without a price`,
      detail: `${unpriced.map((profile) => profile.name).join(", ")} can't start until priced.`,
      href: `/admin/providers/${provider.id}` as Route,
    });
  });
  for (const agent of agentTypes ?? []) {
    if (!agent.isEnabled) continue;
    const hasImage = (images ?? []).some(
      (image) => image.agentTypeId === agent.id && image.isEnabled,
    );
    if (hasImage) continue;
    issues.push({
      id: `agent-${agent.id}`,
      tone: "warn",
      title: `${agent.name} has no runtime image`,
      detail: "Users can pick it, but it can't start.",
      href: "/admin/agents" as Route,
    });
  }
  const github = integrations?.integrations.find((item) => item.key === "github");
  if (integrations && github && integrationStatus(github, integrations) === "unconfigured") {
    issues.push({
      id: "github",
      tone: "muted",
      title: "GitHub isn't set up",
      detail: "Users can only clone public repositories.",
      href: "/admin/integrations/github" as Route,
    });
  }
  const issuesLoading = !providers || !agentTypes || !images || !integrations;

  // The list holds up to 100 users; count plans from it when that is everyone.
  const allUsersLoaded = !!users && users.users.length >= users.total;
  const planCounts = users
    ? users.plans.map((plan) => ({
        plan,
        count: allUsersLoaded
          ? users.users.filter((user) => (user.plan ?? "free") === plan).length
          : null,
      }))
    : [];
  const largestPlan = Math.max(1, ...planCounts.map((entry) => entry.count ?? 0));

  const enabledIntegrations =
    integrations?.integrations.filter((item) => item.ready && item.enabled).length ?? 0;
  const readyIntegrations = integrations?.integrations.filter((item) => item.ready).length ?? 0;
  const idleTimeout = settings?.settings.find((setting) => setting.key === "idle_timeout_minutes");

  const setup: Array<{ label: string; summary: string; tone: Tone; href: Route }> = [
    {
      label: "Cloud providers",
      summary: providers ? `${readyProviders.length} of ${enabledProviders.length} ready` : "…",
      tone: readyProviders.length > 0 ? "ok" : "warn",
      href: "/admin/providers" as Route,
    },
    {
      label: "Integrations",
      summary: integrations ? `${enabledIntegrations} of ${readyIntegrations} on` : "…",
      tone: enabledIntegrations > 0 ? "ok" : "muted",
      href: "/admin/integrations" as Route,
    },
    {
      label: "Agents",
      summary: agentTypes
        ? `${agentTypes.filter((agent) => agent.isEnabled).length} of ${agentTypes.length} on`
        : "…",
      tone: agentTypes?.some((agent) => agent.isEnabled) ? "ok" : "warn",
      href: "/admin/agents" as Route,
    },
    {
      label: "Images",
      summary: images
        ? `${images.filter((image) => image.isEnabled).length} of ${images.length} on`
        : "…",
      tone: images?.some((image) => image.isEnabled) ? "ok" : "warn",
      href: "/admin/images" as Route,
    },
    {
      label: "System settings",
      summary: idleTimeout ? `Idle timeout ${idleTimeout.value} min` : "…",
      tone: "muted",
      href: "/admin/settings" as Route,
    },
  ];

  const loading = <Skeleton className="mt-1.5 h-7 w-12 bg-fill" />;

  return (
    <DashboardShell>
      <DashboardHeader heading="Overview" text="This deployment at a glance." />

      <StatStrip
        stats={[
          {
            label: "Users",
            value: stats ? stats.users.total : loading,
            hint: stats ? plural(stats.users.admins, "admin") : undefined,
          },
          {
            label: "Running workspaces",
            value: stats ? stats.workspaces.running : loading,
            tone: stats?.workspaces.running ? "ok" : undefined,
            hint: stats ? `${stats.workspaces.paused} paused` : undefined,
          },
          billing
            ? {
                label: "Paid users",
                value: stats ? stats.users.paid : loading,
                hint: stats ? `${stats.users.free} on free` : undefined,
              }
            : {
                label: "Workspaces",
                value: stats ? stats.workspaces.total : loading,
                hint: "All time",
              },
          {
            label: "Ready providers",
            value: providers ? readyProviders.length : loading,
            tone: providers && readyProviders.length === 0 ? "warn" : undefined,
            hint: providers ? `of ${enabledProviders.length} enabled` : undefined,
          },
        ]}
      />

      <div className="grid gap-x-10 gap-y-12 lg:grid-cols-5">
        <section className="space-y-4 lg:col-span-3">
          <SectionHeading title="Needs attention" count={issues.length || undefined} />
          {issuesLoading ? (
            <RowsSkeleton />
          ) : issues.length === 0 ? (
            <Panel>
              <PanelRow>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-fill">
                  <Check className="size-4 text-[#6bd586]" />
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-fg">All set</p>
                  <p className="text-[13px] text-fg-3">Nothing here needs fixing.</p>
                </div>
              </PanelRow>
            </Panel>
          ) : (
            <Panel>
              {issues.map((issue) => (
                <LinkRow key={issue.id} href={issue.href}>
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      issue.tone === "warn" ? "bg-[#fb923c]" : "bg-fg-4",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-fg">{issue.title}</p>
                    <p className="mt-0.5 text-[13px] text-fg-3">{issue.detail}</p>
                  </div>
                </LinkRow>
              ))}
            </Panel>
          )}
        </section>

        {billing ? (
          <section className="space-y-4 lg:col-span-2">
            <SectionHeading title="Users by plan" />
            {!users ? (
              <PlansSkeleton />
            ) : (
              <Panel>
                {planCounts.map(({ plan, count }) => (
                  <PanelRow key={plan} className="gap-4">
                    <span className="w-16 shrink-0 text-[14px] text-fg-2 capitalize">{plan}</span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-fill-2">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${((count ?? 0) / largestPlan) * 100}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right font-display text-[15px] font-semibold text-fg tabular-nums">
                      {count ?? "–"}
                    </span>
                  </PanelRow>
                ))}
              </Panel>
            )}
            {!allUsersLoaded && users ? (
              <p className="text-[12.5px] text-fg-4">
                {stats ? `${stats.users.paid} paid, ${stats.users.free} free. ` : null}
                Per-plan counts show for up to 100 users.
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="space-y-4 lg:col-span-3">
          <SectionHeading
            title="Recent sign-ups"
            action={
              <Link
                href={"/admin/users" as Route}
                className="inline-flex items-center gap-1 text-[13px] text-fg-3 transition-colors hover:text-fg"
              >
                All users
                <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {!users ? (
            <RowsSkeleton rows={4} avatar />
          ) : (
            <Panel>
              {users.users.slice(0, 5).map((user) => (
                <PanelRow key={user.id}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fill-2 text-[13px] font-medium text-fg-2">
                    {(user.name || user.email).charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-fg">{user.name}</p>
                    <p className="truncate text-[13px] text-fg-3">{user.email}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {billing ? (
                      <p className="text-[13px] text-fg-2 capitalize">{user.plan ?? "free"}</p>
                    ) : null}
                    <p className="text-[12.5px] text-fg-4" title={String(user.createdAt)}>
                      {timeAgo(user.createdAt)}
                    </p>
                  </div>
                </PanelRow>
              ))}
            </Panel>
          )}
        </section>

        <section className="space-y-4 lg:col-span-2">
          <SectionHeading title="Setup" />
          <Panel>
            {setup.map((item) => (
              <LinkRow key={item.label} href={item.href}>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-fg">{item.label}</p>
                </div>
                <StatusDot tone={item.tone} className="font-normal">
                  {item.summary}
                </StatusDot>
              </LinkRow>
            ))}
          </Panel>
        </section>
      </div>
    </DashboardShell>
  );
}
