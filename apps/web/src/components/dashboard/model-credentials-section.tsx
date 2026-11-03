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
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { Badge } from "@/components/ui/badge";
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
import {
  SettingsEmptyState,
  SettingsSection,
  SettingsSectionBody,
} from "@/components/ui/form-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiKeyDialog } from "./model-credentials/api-key-dialog";
import { ConnectAccountDialog } from "./model-credentials/connect-account-dialog";
import { ProviderLogo } from "./model-credentials/provider-logo";
import type { ModelCredential, ModelProvider } from "./model-credentials/types";

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

  const actions = hasAccounts ? (
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

  return (
    <>
      <SettingsSection
        id="model-credentials"
        className="scroll-mt-24"
        icon={Key}
        title="Model credentials"
        description="Bring your own keys or sign in with a subscription. Gitterm never resells AI access and only injects your credentials into your own workspaces."
        action={actions}
      >
        <SettingsSectionBody>
          {isLoadingCredentials || isLoadingProviders ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full rounded-xl bg-fill" />
              <Skeleton className="h-14 w-full rounded-xl bg-fill" />
            </div>
          ) : credentials.length === 0 ? (
            <SettingsEmptyState
              icon={Key}
              title="Add a model to get started"
              description="Paste an API key from any supported provider, or sign in with an OpenCode Console, Codex, Copilot or SuperGrok subscription."
              action={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setApiKeyOpen(true)}>
                    <Key className="size-3.5" />
                    Add API key
                  </Button>
                  {hasAccounts ? (
                    <Button size="sm" variant="outline" onClick={() => setConnectOpen(true)}>
                      <UserRound className="size-3.5" />
                      Add a subscription
                    </Button>
                  ) : null}
                </div>
              }
            />
          ) : (
            <div className="-mx-2 max-h-[32rem] space-y-0.5 overflow-y-auto">
              {credentials.map((credential) => (
                <div
                  key={credential.id}
                  className={`flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition-[opacity,background-color] hover:bg-fill ${credential.isActive ? "" : "opacity-60"}`}
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fill-2">
                      <ProviderLogo
                        name={credential.providerName}
                        displayName={credential.providerDisplayName}
                        size={18}
                      />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <p className="truncate text-[14.5px] font-medium text-fg">
                          {credential.label}
                        </p>
                        <span className="text-[13px] text-fg-3">
                          {credential.providerDisplayName}
                        </span>
                        {credential.isDefault && credential.isActive && (
                          <Badge className="gap-1">
                            <Star className="fill-current" />
                            Default
                          </Badge>
                        )}
                        {!credential.isActive && <Badge variant="destructive">Revoked</Badge>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-[12.5px] text-fg-4">
                        {credential.authType === "oauth" ? (
                          <span>OAuth</span>
                        ) : (
                          <span className={credential.keySuffix ? "font-mono" : undefined}>
                            {credential.keySuffix ? `...${credential.keySuffix}` : "API key"}
                          </span>
                        )}
                        {credential.lastUsedAt && (
                          <span>
                            Last used{" "}
                            {new Date(credential.lastUsedAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 text-fg-3"
                        aria-label="Credential actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {credential.isActive && (
                        <>
                          {!credential.isDefault && (
                            <DropdownMenuItem
                              onClick={() =>
                                setDefaultCredential.mutate({ credentialId: credential.id })
                              }
                            >
                              <Star className="size-4" />
                              Make default
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => revokeCredential.mutate({ credentialId: credential.id })}
                          >
                            <RefreshCw className="size-4" />
                            Revoke
                          </DropdownMenuItem>
                        </>
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
                </div>
              ))}
            </div>
          )}
        </SettingsSectionBody>
      </SettingsSection>

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
        <DialogContent className="bg-settings-dialog sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete credential</DialogTitle>
            <DialogDescription>
              Running workspaces that use it may stop working. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCredentialToDelete(null)}>
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
                  Deleting...
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
