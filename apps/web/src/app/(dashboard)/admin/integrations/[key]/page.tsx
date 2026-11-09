"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeft, Clock } from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Panel, PanelRow, SectionHeading } from "@/components/dashboard/kit";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/utils/trpc";
import { useAdminGuard } from "../../_components/admin";
import { GithubConfig } from "../_components/github-config";
import { GoogleConfig } from "../_components/google-config";
import { INTEGRATION_META, isIntegrationKey } from "../_components/meta";
import { IntegrationLogo, StatusBadge } from "../_components/ui";
import { integrationStatus, useAdminIntegrations } from "../_components/use-admin-integrations";

export default function AdminIntegrationDetailPage() {
  const router = useRouter();
  const params = useParams<{ key: string }>();
  const key = isIntegrationKey(params.key) ? params.key : null;

  const { ready } = useAdminGuard();
  const { data, isPending, error, refresh } = useAdminIntegrations(ready && !!key);
  const update = useMutation(trpc.admin.integrations.update.mutationOptions());

  useEffect(() => {
    if (ready && !key) router.replace("/admin/integrations");
  }, [ready, key, router]);

  const item = key ? data?.integrations.find((entry) => entry.key === key) : undefined;
  const meta = key ? INTEGRATION_META[key] : null;

  const backButton = (
    <Button asChild variant="ghost" className="text-fg-3">
      <Link href={"/admin/integrations" as Route}>
        <ChevronLeft />
        All integrations
      </Link>
    </Button>
  );

  // The name, logo and summary come from the route, so the header is final while data loads.
  const header = meta ? (
    <DashboardHeader
      heading={item?.name ?? meta.name}
      text={meta.summary}
      icon={<IntegrationLogo meta={meta} />}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {backButton}
        <Button asChild variant="secondary">
          <Link href={"/dashboard/integrations" as Route}>User view</Link>
        </Button>
      </div>
    </DashboardHeader>
  ) : null;

  if (!ready || !key || !meta || isPending || !data || !item) {
    return (
      <DashboardShell>
        {header}
        {error ? (
          <p role="alert" className="text-[14px] text-destructive">
            Couldn&apos;t load integration: {error.message}
          </p>
        ) : (
          <IntegrationSkeleton integrationKey={key} />
        )}
      </DashboardShell>
    );
  }

  const configured = key === "github" ? !!data.githubMode : key === "google" ? !!data.google : true;
  const status = integrationStatus(item, data);

  async function toggle(enabled: boolean) {
    try {
      await update.mutateAsync({
        key: item!.key,
        enabled,
        allowPersonal:
          key === "github"
            ? data!.githubMode?.mode === "app"
            : key === "mcp" || key === "executor"
              ? true
              : item!.allowPersonal,
        allowShared:
          key === "github"
            ? data!.githubMode?.mode === "pat"
            : key === "mcp" || key === "executor"
              ? false
              : item!.allowShared,
      });
      await refresh();
      toast.success(enabled ? `${item!.name} enabled for users` : `${item!.name} disabled`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't update integration");
    }
  }

  return (
    <DashboardShell>
      {header}

      <div className="space-y-12">
        {item.ready ? (
          <Panel>
            <PanelRow className="items-start gap-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Label htmlFor="integration-enabled" className="text-[14px] font-medium text-fg">
                    Available to users
                  </Label>
                  <StatusBadge status={status} />
                </div>
                <p className="max-w-2xl text-[13px] leading-relaxed text-fg-3">
                  {meta.description}
                </p>
                <p className="text-[13px] text-fg-2">
                  {configured
                    ? `When on, users connect ${item.name} from their Integrations page.`
                    : `Finish the setup below before turning ${item.name} on.`}
                </p>
              </div>
              <Switch
                id="integration-enabled"
                className="mt-0.5"
                checked={item.enabled}
                disabled={update.isPending || (!item.enabled && !configured)}
                onCheckedChange={toggle}
              />
            </PanelRow>
          </Panel>
        ) : (
          <div className="rounded-xl border border-line px-5 py-10 text-center">
            <IntegrationLogo meta={meta} size="lg" className="mx-auto" />
            <p className="mt-4 flex items-center justify-center gap-2 text-[15px] font-medium text-fg">
              <Clock className="size-4 text-fg-3" /> Coming later
            </p>
            <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-fg-3">
              {meta.description}
            </p>
          </div>
        )}

        {key === "github" ? <GithubConfig data={data} refresh={refresh} /> : null}
        {key === "google" ? <GoogleConfig data={data} refresh={refresh} /> : null}
      </div>
    </DashboardShell>
  );
}

/** Lines of text as they load, one per width. */
function linesSkeleton(widths: string[]) {
  return widths.map((width, i) => <Skeleton key={i} className={`h-3.5 ${width} bg-fill-2`} />);
}

/** The page's shape while it loads: the availability switch, then the setup section, if any. */
function IntegrationSkeleton({ integrationKey }: { integrationKey: string | null }) {
  return (
    <div className="space-y-12">
      <Panel>
        <PanelRow className="items-start gap-4">
          <div className="min-w-0 flex-1 space-y-2.5">
            <Skeleton className="h-4 w-40 bg-fill-2" />
            {linesSkeleton(["w-full max-w-2xl", "w-2/3", "w-1/3"])}
          </div>
          <Skeleton className="h-5 w-9 shrink-0 rounded-full bg-fill-2" />
        </PanelRow>
      </Panel>

      {integrationKey === "github" ? (
        <section className="space-y-4">
          <SectionHeading title="Repository access" />
          <Skeleton className="h-3.5 w-80 max-w-full bg-fill-2" />
          <div className="grid divide-line overflow-hidden rounded-xl border border-line max-lg:divide-y lg:grid-cols-2 lg:divide-x">
            {[0, 1].map((cell) => (
              <div key={cell} className="space-y-5 p-5 sm:p-6">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28 bg-fill-2" />
                  {linesSkeleton(["w-3/4"])}
                </div>
                {[0, 1, 2].map((field) => (
                  <div key={field} className="space-y-2">
                    <Skeleton className="h-3.5 w-24 bg-fill-2" />
                    <Skeleton className="h-9 w-full rounded-lg bg-fill-2" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : integrationKey === "google" ? (
        <section className="space-y-4">
          <SectionHeading title="Workload identity issuer" />
          <Skeleton className="h-56 w-full rounded-xl bg-fill-2" />
        </section>
      ) : null}
    </div>
  );
}
