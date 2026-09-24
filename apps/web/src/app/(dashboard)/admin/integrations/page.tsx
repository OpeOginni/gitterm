"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  KeyRound,
  Link2,
  LockKeyhole,
  RotateCw,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import env from "@gitterm/env/web";

export default function AdminIntegrationsPage() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    ...trpc.admin.integrations.list.queryOptions(),
    enabled: (session?.user as { role?: string } | undefined)?.role === "admin",
  });
  const [issuer, setIssuer] = useState(
    `${(env.NEXT_PUBLIC_SERVER_URL || "https://api.gitterm.dev").replace(/\/$/, "")}/api/workload-identity`,
  );
  const update = useMutation(trpc.admin.integrations.update.mutationOptions());
  const configure = useMutation(trpc.admin.integrations.configureGoogle.mutationOptions());

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: trpc.admin.integrations.list.queryKey() });
    await queryClient.invalidateQueries({ queryKey: trpc.integrations.list.queryKey() });
    await queryClient.invalidateQueries({ queryKey: trpc.googleCloud.availability.queryKey() });
  }

  if (sessionPending || !session?.user || (session.user as { role?: string }).role !== "admin") {
    return (
      <DashboardShell>
        <p className="py-16 text-center text-sm text-fg-3">Admin access required.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Integrations"
        text="Control which connections are available across this deployment."
      />
      <div className="mx-auto max-w-5xl space-y-8 pb-16">
        <Link
          href={"/admin" as Route}
          className="inline-flex items-center gap-2 text-xs text-fg-3 hover:text-fg"
        >
          <ArrowLeft className="size-3.5" /> Admin overview
        </Link>
        <div className="rounded-2xl border border-line bg-settings p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="rounded-xl border border-line bg-fill p-3">
              <Link2 className="size-5 text-fg-2" />
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-4">
                Control plane
              </p>
              <h2 className="mt-1 text-xl font-semibold text-fg">
                One catalog, different connection models.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-3">
                Enable a service here before users connect it. GitHub login is independent of GitHub
                repository access. Executor and other MCP flows remain planned, not usable yet.
              </p>
            </div>
          </div>
        </div>

        {isPending ? (
          <p className="text-sm text-fg-3">Loading integration policies…</p>
        ) : error ? (
          <p role="alert" className="text-sm text-red-300">
            Couldn’t load integration settings: {error.message}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {data?.integrations.map((item) => (
              <article key={item.key} className="rounded-xl border border-line bg-settings p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-fg-4">
                      {item.category} / {item.ready ? "Available" : "Planned"}
                    </p>
                    <h3 className="mt-2 text-lg font-semibold text-fg">{item.name}</h3>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-1 font-mono text-[10px] ${item.enabled ? "border-emerald-400/30 text-emerald-300" : "border-line text-fg-4"}`}
                  >
                    {item.enabled ? "Enabled" : "Off"}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-fg-3">
                  {item.key === "google"
                    ? "GitTerm signs short-lived identity assertions; users attach their own service accounts."
                    : item.key === "github"
                      ? "Users install the deployment’s GitHub App for repository access. Login is unaffected."
                      : item.key === "executor"
                        ? "A future dedicated connection flow for each user, with optional admin-shared access."
                        : "The connector is not implemented yet. Configuration will appear here when it is ready."}
                </p>
                {item.ready ? (
                  <div className="mt-5 space-y-3 border-t border-line pt-4 text-xs text-fg-2">
                    <label className="flex items-center justify-between gap-3">
                      <span>Enable for users</span>
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        disabled={update.isPending}
                        onChange={async (event) => {
                          try {
                            await update.mutateAsync({
                              key: item.key,
                              enabled: event.target.checked,
                              allowPersonal: item.allowPersonal,
                              allowShared: item.allowShared,
                            });
                            await refresh();
                          } catch (cause) {
                            toast.error(
                              cause instanceof Error
                                ? cause.message
                                : "Couldn’t update integration",
                            );
                          }
                        }}
                        className="size-4 accent-emerald-400"
                      />
                    </label>
                    {item.key === "google" ? (
                      <p className="text-fg-4">
                        Configure the issuer below before enabling this integration.
                      </p>
                    ) : null}
                    {item.key === "github" ? (
                      <p className="text-fg-4">
                        The GitHub App credentials for this deployment are unchanged in this
                        release.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-5 border-t border-line pt-4 font-mono text-[10px] uppercase tracking-widest text-fg-4">
                    Connector coming later
                  </p>
                )}
              </article>
            ))}
          </div>
        )}

        <section className="rounded-2xl border border-line bg-settings p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-sky-400/10 p-2">
              <KeyRound className="size-5 text-sky-300" />
            </div>
            <div>
              <h2 className="font-semibold text-fg">Google Cloud issuer</h2>
              <p className="text-xs text-fg-3">
                Deployment-wide identity used by users’ Google Cloud connections.
              </p>
            </div>
          </div>
          {data?.google ? (
            <div className="mt-6 rounded-xl border border-line bg-fill p-4 text-sm text-fg-2">
              <p className="flex items-center gap-2 text-emerald-300">
                <Check className="size-4" /> Signing key stored encrypted in GitTerm
              </p>
              <p className="mt-3 break-all font-mono text-xs">{data.google.issuer}</p>
              <p className="mt-1 font-mono text-[10px] text-fg-4">Key ID: {data.google.keyId}</p>
            </div>
          ) : (
            <p className="mt-5 text-sm text-fg-3">
              Generate a signing key here; no Google service-account private key is needed. Existing
              deployments using env configuration continue to work until you migrate.
            </p>
          )}
          <label className="mt-5 block space-y-2 text-xs text-fg-3">
            <span>Public issuer URL (the API URL + /api/workload-identity)</span>
            <Input
              value={data?.google?.issuer ?? issuer}
              onChange={(event) => setIssuer(event.target.value)}
              disabled={!!data?.google}
              className="bg-fill font-mono text-xs"
            />
          </label>
          <p className="mt-2 text-xs text-amber-200/80">
            Use the publicly reachable API URL. Rotating a key keeps the old public key available
            briefly; do not change the issuer URL after connecting Google projects.
          </p>
          <Button
            className="mt-5 gap-2"
            disabled={configure.isPending || !data}
            onClick={async () => {
              const rotate = !!data?.google;
              if (
                rotate &&
                !window.confirm(
                  "Rotate the deployment-wide Google signing key? Existing tokens may need to refresh.",
                )
              )
                return;
              try {
                await configure.mutateAsync({ issuer: data?.google?.issuer ?? issuer, rotate });
                await refresh();
                toast.success(rotate ? "Google signing key rotated" : "Google issuer configured");
              } catch (cause) {
                toast.error(
                  cause instanceof Error ? cause.message : "Couldn’t configure Google issuer",
                );
              }
            }}
          >
            {data?.google ? <RotateCw className="size-4" /> : <LockKeyhole className="size-4" />}
            {data?.google ? "Rotate signing key" : "Generate signing key"}
          </Button>
          <Link
            href={"/dashboard/integrations" as Route}
            className="mt-5 flex items-center gap-1 text-xs text-fg-3 hover:text-fg"
          >
            See the user connection flow <ArrowUpRight className="size-3" />
          </Link>
        </section>
      </div>
    </DashboardShell>
  );
}
