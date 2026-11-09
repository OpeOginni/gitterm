"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  Key,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsEmpty } from "@/components/dashboard/settings/settings-page";
import { SectionHeading, StatusDot } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiKeyDialog } from "./model-credentials/api-key-dialog";
import { ConnectAccountDialog } from "./model-credentials/connect-account-dialog";
import { ProviderLogo } from "./model-credentials/provider-logo";
import type { ModelCredential, ModelProvider } from "./model-credentials/types";

/** Two provider groups, each a header line over credential rows, like the loaded list. */
function CredentialsSkeleton() {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      {[2, 1].map((rows, group) => (
        <div key={group}>
          <div className="flex items-center gap-3 px-4 pt-4 pb-1 sm:px-5">
            <Skeleton className="size-7 shrink-0 rounded-lg bg-fill-2" />
            <Skeleton className="h-4 w-24 bg-fill-2" />
          </div>
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="space-y-2 py-3 pr-3 pl-14 sm:pr-4 sm:pl-[3.75rem]">
              <Skeleton className="h-4 w-32 bg-fill-2" />
              <Skeleton className="h-3.5 w-44 bg-fill-2" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ModelCredentialsSection() {
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [credentialToDelete, setCredentialToDelete] = useState<string | null>(null);

  const { data: providersData, isLoading: isLoadingProviders } = useQuery(
    trpc.modelCredentials.listProviders.queryOptions(),
  );
  const { data: credentialsData, isLoading: isLoadingCredentials } = useQuery(
    trpc.modelCredentials.listMyCredentials.queryOptions(),
  );

  const providers: ModelProvider[] = useMemo(
    () => providersData?.providers ?? [],
    [providersData?.providers],
  );
  const credentials: ModelCredential[] = useMemo(
    () => credentialsData?.credentials ?? [],
    [credentialsData?.credentials],
  );
  const hasAccounts = providers.some((provider) => provider.authType === "oauth");

  const invalidateCredentials = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: trpc.modelCredentials.listMyCredentials.queryKey(),
    });
  }, []);

  const revokeCredential = useMutation(
    trpc.modelCredentials.revokeCredential.mutationOptions({
      onSuccess: () => {
        toast.success("Credential revoked");
        invalidateCredentials();
      },
      onError: (error) => toast.error(`Failed to revoke: ${error.message}`),
    }),
  );

  const setDefaultCredential = useMutation(
    trpc.modelCredentials.setDefaultCredential.mutationOptions({
      onSuccess: () => {
        toast.success("Default credential updated");
        invalidateCredentials();
      },
      onError: (error) => toast.error(`Failed to update default: ${error.message}`),
    }),
  );

  const deleteCredential = useMutation(
    trpc.modelCredentials.deleteCredential.mutationOptions({
      onSuccess: () => {
        toast.success("Credential deleted");
        setCredentialToDelete(null);
        invalidateCredentials();
      },
      onError: (error) => toast.error(`Failed to delete: ${error.message}`),
    }),
  );

  const actions =
    hasAccounts || isLoadingProviders ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button disabled={isLoadingProviders}>
            <Plus className="size-4" />
            Add credential
            <ChevronDown className="size-4 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="min-w-[var(--radix-dropdown-menu-trigger-width)] p-1 shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
        >
          <DropdownMenuItem
            onSelect={() => setApiKeyOpen(true)}
            className="h-9 cursor-pointer gap-2.5 px-2.5 text-[13.5px] font-medium text-fg-2 focus:bg-fill-2 focus:text-fg"
          >
            <Key className="size-4 text-fg-3" />
            Add API key
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setConnectOpen(true)}
            className="h-9 cursor-pointer gap-2.5 px-2.5 text-[13.5px] font-medium text-fg-2 focus:bg-fill-2 focus:text-fg"
          >
            <UserRound className="size-4 text-fg-3" />
            Add a subscription
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <Button onClick={() => setApiKeyOpen(true)} disabled={isLoadingProviders}>
        <Plus className="size-4" />
        Add API key
      </Button>
    );

  const groups = groupByProvider(credentials, providers);

  return (
    <>
      <section id="model-credentials" className="scroll-mt-24 space-y-4">
        <SectionHeading
          title="Credentials"
          count={credentials.length || undefined}
          action={actions}
        />
        <p className="-mt-1 max-w-2xl text-[13.5px] leading-relaxed text-fg-3">
          Your own keys and subscriptions. Each provider has one default. GitTerm never resells AI
          access and only passes these to your own workspaces.
        </p>
        {isLoadingCredentials || isLoadingProviders ? (
          <CredentialsSkeleton />
        ) : credentials.length === 0 ? (
          <div className="flex flex-col gap-4 rounded-xl border border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <SettingsEmpty
              icon={<Key />}
              title="Add a model to get started"
              description="Paste an API key from any provider, or sign in with an OpenCode Console, Codex, Copilot or SuperGrok subscription."
            />
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button size="sm" onClick={() => setApiKeyOpen(true)}>
                <Key className="size-3.5" />
                Add API key
              </Button>
              {hasAccounts ? (
                <Button size="sm" variant="secondary" onClick={() => setConnectOpen(true)}>
                  <UserRound className="size-3.5" />
                  Add a subscription
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="max-h-[40rem] divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {groups.map((group) => (
              <div key={group.key}>
                <div className="flex items-center gap-3 px-4 pt-4 pb-1 sm:px-5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-fill">
                    <ProviderLogo name={group.logo} displayName={group.name} size={15} />
                  </span>
                  <span className="text-[13.5px] font-medium text-fg-2">{group.name}</span>
                </div>
                <ul>
                  {group.credentials.map((credential) => {
                    const canBeDefault =
                      credential.isActive && !credential.isDefault && group.active > 1;
                    return (
                      <li
                        key={credential.id}
                        className={cn(
                          "flex items-center gap-3 py-2.5 pr-3 pl-14 transition-colors hover:bg-fill sm:pr-4 sm:pl-[3.75rem]",
                          !credential.isActive && "opacity-60",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium text-fg">
                            {credential.label}
                          </p>
                          <p className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 text-[12.5px] text-fg-3">
                            <span>
                              {credential.authType === "oauth"
                                ? `${credential.providerDisplayName} subscription`
                                : credential.providerDisplayName === group.name
                                  ? "API key"
                                  : `${credential.providerDisplayName} key`}
                              {credential.keySuffix ? (
                                <span className="ml-1.5 font-mono text-fg-4">
                                  …{credential.keySuffix}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-fg-4">
                              {credential.lastUsedAt
                                ? `Used ${new Date(credential.lastUsedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                                : "Never used"}
                            </span>
                          </p>
                        </div>
                        {!credential.isActive ? (
                          <StatusDot tone="danger" className="shrink-0">
                            Revoked
                          </StatusDot>
                        ) : credential.isDefault ? (
                          <StatusDot tone="ok" className="shrink-0">
                            Default
                          </StatusDot>
                        ) : canBeDefault ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 shrink-0 px-2.5 text-fg-3 hover:text-fg"
                            disabled={setDefaultCredential.isPending}
                            onClick={() =>
                              setDefaultCredential.mutate({ credentialId: credential.id })
                            }
                          >
                            Make default
                          </Button>
                        ) : null}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0 text-fg-3"
                              aria-label={`Actions for ${credential.label}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {credential.isActive && (
                              <DropdownMenuItem
                                onClick={() =>
                                  revokeCredential.mutate({ credentialId: credential.id })
                                }
                              >
                                <RefreshCw className="size-4" />
                                Revoke
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setCredentialToDelete(credential.id)}
                            >
                              <Trash2 className="size-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </li>
                    );
                  })}
                </ul>
                <div className="h-1.5" />
              </div>
            ))}
          </div>
        )}
      </section>

      <ApiKeyDialog
        open={apiKeyOpen}
        onOpenChange={setApiKeyOpen}
        providers={providers}
        credentials={credentials}
        onSaved={invalidateCredentials}
      />
      <ConnectAccountDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        providers={providers}
        credentials={credentials}
        onConnected={invalidateCredentials}
      />

      <Dialog
        open={credentialToDelete !== null}
        onOpenChange={(open) => !open && setCredentialToDelete(null)}
      >
        <DialogContent className="border-line bg-settings-dialog sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete credential</DialogTitle>
            <DialogDescription>
              Running workspaces that use it may stop working. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCredentialToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                credentialToDelete && deleteCredential.mutate({ credentialId: credentialToDelete })
              }
              disabled={deleteCredential.isPending}
            >
              {deleteCredential.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="size-4" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Default first, then other active credentials, then revoked ones. */
const rank = (credential: ModelCredential) =>
  !credential.isActive ? 2 : credential.isDefault ? 0 : 1;

/**
 * Credentials grouped by the provider they count toward. Defaults are per group (Codex and an
 * OpenAI key share one), so each group lists its default first.
 */
function groupByProvider(credentials: ModelCredential[], providers: ModelProvider[]) {
  const groups = new Map<
    string,
    { key: string; name: string; logo: string; active: number; credentials: ModelCredential[] }
  >();
  for (const credential of credentials) {
    const key = credential.logicalProviderKey;
    let group = groups.get(key);
    if (!group) {
      const provider = providers.find((entry) => entry.name === key);
      group = {
        key,
        name: provider?.displayName ?? credential.providerDisplayName,
        logo: provider?.name ?? credential.providerName,
        active: 0,
        credentials: [],
      };
      groups.set(key, group);
    }
    group.credentials.push(credential);
    if (credential.isActive) group.active += 1;
  }
  return [...groups.values()].map((group) => ({
    ...group,
    credentials: group.credentials.toSorted((a, b) => rank(a) - rank(b)),
  }));
}
