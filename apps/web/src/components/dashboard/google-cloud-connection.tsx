"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryClient, trpc } from "@/utils/trpc";

const DOCS = {
  guide: "https://github.com/OpeOginni/gitterm/blob/main/docs/google-workload-identity.md",
  projectNumber:
    "https://cloud.google.com/resource-manager/docs/creating-managing-projects#identifying_projects",
  serviceAccounts: "https://cloud.google.com/iam/docs/service-accounts-create",
  grantRoles: "https://cloud.google.com/iam/docs/manage-access-service-accounts",
  workloadIdentity: "https://cloud.google.com/iam/docs/workload-identity-federation",
};

const DEFAULT_POOL_ID = "gitterm";
const DEFAULT_PROVIDER_ID = "gitterm";

const EMPTY_FORM = {
  name: "",
  projectId: "",
  projectNumber: "",
  serviceAccountEmail: "",
  poolId: DEFAULT_POOL_ID,
  providerId: DEFAULT_PROVIDER_ID,
};

type FormState = typeof EMPTY_FORM;

const GCP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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

/** Users never type this; it is assembled from the project number and pool/provider IDs. */
function providerResourceName(form: FormState): string | null {
  const projectNumber = form.projectNumber.trim();
  const poolId = form.poolId.trim() || DEFAULT_POOL_ID;
  const providerId = form.providerId.trim() || DEFAULT_PROVIDER_ID;
  if (!/^\d+$/.test(projectNumber)) return null;
  if (!GCP_ID_PATTERN.test(poolId) || !GCP_ID_PATTERN.test(providerId)) return null;
  return `projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
}

function googleAudience(provider: string): string {
  return `//iam.googleapis.com/${provider}`;
}

/** Step 1: create the pool and OIDC provider that trusts this GitTerm deployment. */
function createProviderCommands(form: FormState, issuer: string): string | null {
  const provider = providerResourceName(form);
  const projectId = form.projectId.trim();
  if (!provider || !projectId) return null;
  const poolId = form.poolId.trim() || DEFAULT_POOL_ID;
  const providerId = form.providerId.trim() || DEFAULT_PROVIDER_ID;
  return [
    `gcloud iam workload-identity-pools create '${poolId}' --location=global --project='${projectId}' --display-name='GitTerm workspaces'`,
    `gcloud iam workload-identity-pools providers create-oidc '${providerId}' --location=global --project='${projectId}' --workload-identity-pool='${poolId}' --issuer-uri='${issuer}' --allowed-audiences='${googleAudience(provider)}' --attribute-mapping='google.subject=assertion.sub,attribute.integration_id=assertion.integration_id'`,
  ].join("\n");
}

/** Same as step 1, rebuilt from a saved identity's stored provider path. */
function googleProviderCommands(integration: {
  workloadIdentityProvider: string;
  projectId: string;
  setup: { issuer: string; audience: string };
}): string {
  const [, , pool, providerId] =
    integration.workloadIdentityProvider.match(
      /^projects\/(\d+)\/locations\/global\/workloadIdentityPools\/([A-Za-z0-9_-]+)\/providers\/([A-Za-z0-9_-]+)$/,
    ) ?? [];
  if (!pool || !providerId) return "";
  return [
    `gcloud iam workload-identity-pools create '${pool}' --location=global --project='${integration.projectId}' --display-name='GitTerm workspaces'`,
    `gcloud iam workload-identity-pools providers create-oidc '${providerId}' --location=global --project='${integration.projectId}' --workload-identity-pool='${pool}' --issuer-uri='${integration.setup.issuer}' --allowed-audiences='${integration.setup.audience}' --attribute-mapping='google.subject=assertion.sub,attribute.integration_id=assertion.integration_id'`,
  ].join("\n");
}

function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 text-fg-3 underline decoration-dotted underline-offset-2 hover:text-fg"
    >
      {children}
      <ExternalLink className="size-2.5" />
    </a>
  );
}

function CommandBlock({ command, muted = false }: { command: string; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => copy(command)}
      className={`flex w-full items-start gap-2 rounded-lg border border-line p-3 text-left font-mono text-[11px] transition-colors hover:border-line-2 ${
        muted ? "bg-fill text-fg-3" : "bg-settings text-fg-2"
      }`}
    >
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{command}</span>
      <Copy className="mt-0.5 size-3 shrink-0" />
    </button>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={className ?? "space-y-1.5"}>
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-4">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] leading-relaxed text-fg-4">{hint}</span> : null}
    </label>
  );
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
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
  const issuer = availability?.issuer ?? null;
  const provider = useMemo(() => providerResourceName(form), [form]);
  const setupCommands = useMemo(
    () => (issuer ? createProviderCommands(form, issuer) : null),
    [form, issuer],
  );
  const update = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const createIntegration = useMutation(trpc.googleCloud.create.mutationOptions());
  const removeIntegration = useMutation(trpc.googleCloud.remove.mutationOptions());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!provider) {
      toast.error("Enter a numeric project number");
      return;
    }
    try {
      await createIntegration.mutateAsync({
        name: form.name,
        projectId: form.projectId,
        workloadIdentityProvider: provider,
        serviceAccountEmail: form.serviceAccountEmail,
      });
      setForm(EMPTY_FORM);
      setShowAdvanced(false);
      setAdding(false);
      await refreshGoogleIntegrations();
      toast.success("Identity saved. One IAM command left; see the card below.");
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
              Three copy-paste commands, run from your own machine with{" "}
              <code>gcloud auth login</code>. GitTerm stores only resource identifiers—never a
              Google private key. New to this?{" "}
              <DocLink href={DOCS.guide}>Read the full setup guide</DocLink> or Google&apos;s{" "}
              <DocLink href={DOCS.workloadIdentity}>Workload Identity Federation docs</DocLink>.
            </p>
          </div>

          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-fg-3">
            1 · Tell GitTerm about your project
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name">
              <Input
                required
                value={form.name}
                placeholder="Production"
                onChange={update("name")}
                className="h-10 bg-settings font-mono text-xs"
              />
            </Field>
            <Field label="Google project ID">
              <Input
                required
                value={form.projectId}
                placeholder="my-project-123456"
                onChange={update("projectId")}
                className="h-10 bg-settings font-mono text-xs"
              />
            </Field>
            <Field
              label="Google project number"
              hint={
                form.projectId.trim() ? (
                  <>
                    Look it up:{" "}
                    <button
                      type="button"
                      onClick={() =>
                        copy(
                          `gcloud projects describe '${form.projectId.trim()}' --format='value(projectNumber)'`,
                        )
                      }
                      className="font-mono text-fg-3 underline decoration-dotted underline-offset-2 hover:text-fg"
                    >
                      gcloud projects describe {form.projectId.trim()}{" "}
                      --format=&apos;value(projectNumber)&apos;
                    </button>
                  </>
                ) : (
                  <>
                    The numeric ID, not the project ID.{" "}
                    <DocLink href={DOCS.projectNumber}>Where to find it</DocLink>
                  </>
                )
              }
            >
              <Input
                required
                inputMode="numeric"
                value={form.projectNumber}
                placeholder="123456789012"
                onChange={update("projectNumber")}
                className="h-10 bg-settings font-mono text-xs"
              />
            </Field>
            <Field
              label="Service account"
              hint={
                <>
                  The account workspaces will act as; its roles are all a workspace can do.{" "}
                  <DocLink href={DOCS.serviceAccounts}>Create one</DocLink> ·{" "}
                  <DocLink href={DOCS.grantRoles}>Grant roles</DocLink>
                </>
              }
            >
              <Input
                required
                value={form.serviceAccountEmail}
                placeholder="agent@project.iam.gserviceaccount.com"
                onChange={update("serviceAccountEmail")}
                className="h-10 bg-settings font-mono text-xs"
              />
            </Field>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            className="mt-4 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-fg-4 hover:text-fg-3"
          >
            <ChevronDown
              className={`size-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
            Use an existing pool or provider
          </button>
          {showAdvanced ? (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Workload Identity Pool ID">
                <Input
                  value={form.poolId}
                  placeholder={DEFAULT_POOL_ID}
                  onChange={update("poolId")}
                  className="h-10 bg-settings font-mono text-xs"
                />
              </Field>
              <Field label="OIDC provider ID">
                <Input
                  value={form.providerId}
                  placeholder={DEFAULT_PROVIDER_ID}
                  onChange={update("providerId")}
                  className="h-10 bg-settings font-mono text-xs"
                />
              </Field>
            </div>
          ) : null}

          <div className="mt-6 border-t border-line pt-5">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-fg-3">
              2 · Create the pool and provider in Google
            </p>
            {setupCommands ? (
              <>
                <p className="mb-3 text-xs leading-relaxed text-fg-3">
                  Run these once per project. Skip the first command if the pool already exists.
                  They change your Google IAM configuration, not GitTerm.
                </p>
                <CommandBlock command={setupCommands} />
                {provider ? (
                  <p className="mt-2 truncate font-mono text-[10px] text-fg-4">
                    Provider: {provider}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-fg-4">
                Fill in the project ID and number above to generate the commands.
              </p>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-5">
            <p className="text-[11px] leading-relaxed text-fg-4">
              3 · Save, then run the final IAM command shown on the identity card.
            </p>
            <Button
              type="submit"
              disabled={createIntegration.isPending || !provider}
              className="shrink-0 gap-2"
            >
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
      ) : error ? (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
          Couldn’t load your Google Cloud identities. Try again in a moment.
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
              <div className="mt-4 rounded-lg border border-line bg-fill p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-fg-3">
                  3 · Allow this identity to use the service account
                </p>
                <p className="mt-2 text-xs leading-relaxed text-fg-3">
                  Run once on your machine. It grants <code>roles/iam.workloadIdentityUser</code> on
                  the service account to this identity only.
                </p>
                <div className="mt-3">
                  <CommandBlock
                    command={`gcloud iam service-accounts add-iam-policy-binding '${integration.serviceAccountEmail}' --project='${integration.projectId}' --role='roles/iam.workloadIdentityUser' --member='${integration.setup.principalSet}'`}
                  />
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-fg-4 hover:text-fg-3">
                    Pool or provider missing? Re-create them
                  </summary>
                  <div className="mt-2">
                    <CommandBlock command={googleProviderCommands(integration)} muted />
                  </div>
                </details>
              </div>
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
