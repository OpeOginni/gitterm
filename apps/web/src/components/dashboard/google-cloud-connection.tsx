"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { Check, Copy, KeyRound, Loader2, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryClient, trpc } from "@/utils/trpc";

const EMPTY_FORM = {
  name: "",
  projectId: "",
  workloadIdentityProvider: "",
  serviceAccountEmail: "",
};

async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied");
  } catch {
    toast.error("Couldn't copy to clipboard");
  }
}

async function refreshGoogleIntegrations() {
  await queryClient.invalidateQueries({ queryKey: trpc.googleCloud.list.queryKey() });
}

function CopyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-4">{label}</span>
      <button
        type="button"
        onClick={() => copy(value)}
        className="group flex w-full items-center gap-2 rounded-lg border border-line bg-fill px-3 py-2 text-left font-mono text-[11px] text-fg-3 transition-colors hover:border-line-2 hover:text-fg"
      >
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <Copy className="size-3 shrink-0 opacity-50 group-hover:opacity-100" />
      </button>
    </div>
  );
}

export function GoogleCloudConnection() {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const {
    data: integrations = [],
    isLoading,
    error,
  } = useQuery(trpc.googleCloud.list.queryOptions());
  const { data: availability, isLoading: isLoadingAvailability } = useQuery(
    trpc.googleCloud.availability.queryOptions(),
  );
  const isAvailable = availability?.available === true;
  const createIntegration = useMutation(trpc.googleCloud.create.mutationOptions());
  const removeIntegration = useMutation(trpc.googleCloud.remove.mutationOptions());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await createIntegration.mutateAsync(form);
      setForm(EMPTY_FORM);
      setAdding(false);
      await refreshGoogleIntegrations();
      toast.success("Google Cloud identity connected");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't connect Google Cloud");
    }
  }

  async function remove(id: string) {
    setRemovingId(id);
    try {
      await removeIntegration.mutateAsync({ id });
      await refreshGoogleIntegrations();
      toast.success("Google Cloud identity disconnected");
    } catch {
      toast.error("Couldn't disconnect Google Cloud");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Image
            src="/google-cloud.svg"
            alt=""
            width={28}
            height={28}
            className="size-7 shrink-0"
          />
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-semibold tracking-tight text-fg">Google Cloud</h2>
              {integrations.length ? (
                <span className="font-mono text-[10px] text-fg-4">
                  {integrations.length} identities
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Keyless gcloud access through Workload Identity Federation.
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setAdding((value) => !value)}
          disabled={!isAvailable || isLoadingAvailability}
          className="h-9 gap-1.5 px-3.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em]"
        >
          {adding ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          {adding ? "Cancel" : "Add identity"}
        </Button>
      </header>

      {adding && isAvailable ? (
        <form
          onSubmit={submit}
          className="rounded-xl border border-sky-400/20 bg-sky-400/[0.035] p-5"
        >
          <div className="mb-5 flex gap-3 border-b border-line pb-4">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sky-300" />
            <p className="text-[12.5px] leading-relaxed text-fg-3">
              Create an OIDC provider in a Google Workload Identity Pool first. GitTerm stores only
              these resource identifiers—never a Google private key.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["name", "Display name", "Culinu dev"],
              ["projectId", "Google project ID", "kuechenzauber-dev"],
              [
                "workloadIdentityProvider",
                "Provider resource name",
                "projects/123456789/locations/global/workloadIdentityPools/gitterm/providers/gitterm",
              ],
              ["serviceAccountEmail", "Service account", "agent@project.iam.gserviceaccount.com"],
            ].map(([key, label, placeholder]) => (
              <label
                key={key}
                className={
                  key === "workloadIdentityProvider" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"
                }
              >
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-4">
                  {label}
                </span>
                <Input
                  required
                  value={form[key as keyof typeof form]}
                  placeholder={placeholder}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className="h-10 bg-settings font-mono text-xs"
                />
              </label>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
            <Button type="submit" disabled={createIntegration.isPending} className="gap-2">
              {createIntegration.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Save identity
            </Button>
          </div>
        </form>
      ) : null}

      {isLoading || isLoadingAvailability ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-fg-4" />
        </div>
      ) : !isAvailable || error ? (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
          Google workload identity is disabled because this deployment has no issuer or signing key
          configured.
        </div>
      ) : integrations.length ? (
        <div className="grid gap-4">
          {integrations.map((integration) => (
            <article key={integration.id} className="rounded-xl border border-line bg-settings p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-fg">{integration.name}</h3>
                    <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.16em] text-emerald-300">
                      <Check className="size-3" /> Keyless
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-fg-3">
                    {integration.serviceAccountEmail}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Disconnect ${integration.name}`}
                  disabled={removingId === integration.id}
                  onClick={() => remove(integration.id)}
                  className="rounded-lg p-2 text-fg-4 transition-colors hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50"
                >
                  {removingId === integration.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </button>
              </div>
              <div className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                <CopyValue label="Issuer URI" value={integration.setup.issuer} />
                <CopyValue label="Allowed audience" value={integration.setup.audience} />
                <div className="sm:col-span-2">
                  <CopyValue
                    label="Service-account IAM principal"
                    value={integration.setup.principalSet}
                  />
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-fg-4">
                Provider mapping: <code>google.subject=assertion.sub</code>,{" "}
                <code>attribute.integration_id=assertion.integration_id</code>. Grant the principal
                above <code>roles/iam.workloadIdentityUser</code> on this service account.
              </p>
            </article>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <Image src="/google-cloud.svg" alt="" width={32} height={32} className="size-8" />
          <p className="mt-4 text-sm font-semibold text-fg">No Google Cloud identities</p>
          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-fg-3">
            Connect a narrowly scoped service account without downloading or storing a JSON key.
          </p>
        </div>
      )}
    </section>
  );
}
