"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ArrowUpRight, Clock, Power } from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { GithubConfig } from "../_components/github-config";
import { GoogleConfig } from "../_components/google-config";
import { INTEGRATION_META, isIntegrationKey } from "../_components/meta";
import { IntegrationLogo, StatusBadge } from "../_components/ui";
import { useAdminIntegrations } from "../_components/use-admin-integrations";

export default function AdminIntegrationDetailPage() {
  const router = useRouter();
  const params = useParams<{ key: string }>();
  const key = isIntegrationKey(params.key) ? params.key : null;

  const { data: session, isPending: sessionPending } = authClient.useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";
  const { data, isPending, error, refresh } = useAdminIntegrations(isAdmin && !!key);
  const update = useMutation(trpc.admin.integrations.update.mutationOptions());

  useEffect(() => {
    if (sessionPending) return;
    if (!session?.user) router.push("/login");
    else if (!isAdmin) router.push("/dashboard");
    else if (!key) router.replace("/admin/integrations");
  }, [session?.user, sessionPending, isAdmin, key, router]);

  const item = key ? data?.integrations.find((entry) => entry.key === key) : undefined;
  const meta = key ? INTEGRATION_META[key] : null;

  const backButton = (
    <Button asChild variant="outline">
      <Link
        href={"/admin/integrations" as Route}
        className="font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        Back to Integrations
      </Link>
    </Button>
  );

  if (sessionPending || !isAdmin || !key || !meta || isPending || !data || !item) {
    return (
      <DashboardShell>
        <DashboardHeader heading={item?.name ?? "Integration"} text={meta?.summary}>
          {backButton}
        </DashboardHeader>
        <div className="space-y-4 pt-2">
          {error ? (
            <p role="alert" className="text-sm text-red-400">
              Couldn’t load integration: {error.message}
            </p>
          ) : (
            <>
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-64 w-full rounded-2xl" />
            </>
          )}
        </div>
      </DashboardShell>
    );
  }

  const configured = key === "github" ? !!data.githubMode : key === "google" ? !!data.google : true;
  const status = !item.ready
    ? "planned"
    : item.enabled
      ? "enabled"
      : configured
        ? "disabled"
        : "unconfigured";

  async function toggle(enabled: boolean) {
    try {
      await update.mutateAsync({
        key: item!.key,
        enabled,
        allowPersonal: key === "github" ? data!.githubMode?.mode === "app" : item!.allowPersonal,
        allowShared: key === "github" ? data!.githubMode?.mode === "pat" : item!.allowShared,
      });
      await refresh();
      toast.success(enabled ? `${item!.name} enabled for users` : `${item!.name} disabled`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn’t update integration");
    }
  }

  return (
    <DashboardShell>
      <DashboardHeader
        heading={item.name}
        text={meta.summary}
        icon={<IntegrationLogo meta={meta} />}
      >
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link
              href={"/dashboard/integrations" as Route}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              User view <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
          {backButton}
        </div>
      </DashboardHeader>

      <div className="space-y-6 pt-2">
        {item.ready ? (
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Power className="size-4 text-muted-foreground" />
                  <Label
                    htmlFor="integration-enabled"
                    className="text-sm font-medium text-foreground/90"
                  >
                    Available to users
                  </Label>
                  <StatusBadge status={status} />
                </div>
                <p className="max-w-2xl text-xs text-muted-foreground">{meta.description}</p>
                <p className="text-xs text-muted-foreground/80">
                  {configured
                    ? `When enabled, users can connect ${item.name} from their Integrations page.`
                    : `Finish the configuration below before enabling ${item.name} for users.`}
                </p>
              </div>
              <Switch
                id="integration-enabled"
                checked={item.enabled}
                disabled={update.isPending || (!item.enabled && !configured)}
                onCheckedChange={toggle}
              />
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
            <IntegrationLogo meta={meta} size="lg" className="mx-auto" />
            <div className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-foreground/90">
              <Clock className="size-4 text-muted-foreground" /> Connector coming later
            </div>
            <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
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
