"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ArrowUpRight, Clock } from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { SettingsGroup } from "@/components/dashboard/settings/settings-page";
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
    <Button asChild variant="secondary">
      <Link href={"/admin/integrations" as Route}>Back to integrations</Link>
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
            <p role="alert" className="text-[14px] text-destructive">
              Couldn’t load integration: {error.message}
            </p>
          ) : (
            <>
              <Skeleton className="h-24 w-full rounded-2xl bg-fill" />
              <Skeleton className="h-64 w-full rounded-2xl bg-fill" />
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
          <Button asChild variant="ghost">
            <Link
              href={"/dashboard/integrations" as Route}
              className="gap-1.5 text-fg-3 hover:text-fg"
            >
              User view <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
          {backButton}
        </div>
      </DashboardHeader>

      <div className="space-y-6">
        {item.ready ? (
          <SettingsGroup>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="integration-enabled" className="text-[15px] font-medium text-fg">
                    Available to users
                  </Label>
                  <StatusBadge status={status} />
                </div>
                <p className="max-w-2xl text-[13.5px] leading-relaxed text-fg-3">
                  {meta.description}
                </p>
                <p className="text-[13px] text-fg-3">
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
          </SettingsGroup>
        ) : (
          <SettingsGroup bodyClassName="py-10 text-center">
            <IntegrationLogo meta={meta} size="lg" className="mx-auto" />
            <p className="mt-4 flex items-center justify-center gap-2 text-[15px] font-medium text-fg">
              <Clock className="size-4 text-fg-3" /> Connector coming later
            </p>
            <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-fg-3">
              {meta.description}
            </p>
          </SettingsGroup>
        )}

        {key === "github" ? <GithubConfig data={data} refresh={refresh} /> : null}
        {key === "google" ? <GoogleConfig data={data} refresh={refresh} /> : null}
      </div>
    </DashboardShell>
  );
}
