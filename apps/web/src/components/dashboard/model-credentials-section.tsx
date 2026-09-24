"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
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

  const actions = (
    <>
      {hasAccounts && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConnectOpen(true)}
          disabled={isLoadingProviders}
          className="gap-2 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          <UserRound className="h-3.5 w-3.5" />
          Connect account
        </Button>
      )}
      <Button
        size="sm"
        onClick={() => setApiKeyOpen(true)}
        disabled={isLoadingProviders}
        className="gap-2 font-mono text-[11px] uppercase tracking-[0.18em]"
      >
        <Plus className="h-3.5 w-3.5" />
        Add API key
      </Button>
    </>
  );

  return (
    <>
      <SettingsSection
        id="model-credentials"
        className="scroll-mt-24"
        icon={Key}
        title="Model credentials"
        description="Bring your own keys or sign in with a subscription. We never resell AI access, and your credentials are only injected into your workspaces."
        action={actions}
      >
        <SettingsSectionBody>
          {isLoadingCredentials || isLoadingProviders ? (
            <div className="divide-y divide-line border-y border-line">
              <Skeleton className="h-14 w-full bg-fill" />
              <Skeleton className="h-14 w-full bg-fill" />
            </div>
          ) : credentials.length === 0 ? (
            <SettingsEmptyState
              icon={Key}
              title="No credentials saved"
              description="Connect an OpenCode, ChatGPT, Copilot or SuperGrok subscription, or paste an API key from any supported provider."
            />
          ) : (
            <div className="divide-y divide-line">
              {credentials.map((credential) => (
                <div
                  key={credential.id}
                  className={`flex items-center justify-between gap-3 px-1 py-3 transition-opacity ${credential.isActive ? "" : "opacity-60"}`}
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fill-2">
                      <ProviderLogo
                        name={credential.providerName}
                        displayName={credential.providerDisplayName}
                        size={18}
                      />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <p className="truncate text-sm font-medium">{credential.label}</p>
                        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-fg-4">
                          · {credential.providerDisplayName}
                        </span>
                        {credential.isDefault && credential.isActive && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-primary/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-primary/80">
                            <Star className="h-2.5 w-2.5 fill-current text-primary opacity-80" />
                            Default
                          </span>
                        )}
                        {!credential.isActive && (
                          <Badge variant="destructive" className="text-xs">
                            Revoked
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {credential.authType === "oauth" ? (
                          <span>Signed in with OAuth</span>
                        ) : (
                          <span className="font-mono">...{credential.keyHash.slice(-8)}</span>
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
                        className="h-8 w-8"
                        aria-label="Credential actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="border-border/90">
                      {credential.isActive && (
                        <>
                          {!credential.isDefault && (
                            <DropdownMenuItem
                              onClick={() =>
                                setDefaultCredential.mutate({ credentialId: credential.id })
                              }
                            >
                              <Star className="mr-2 h-4 w-4" />
                              Make default
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => revokeCredential.mutate({ credentialId: credential.id })}
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Revoke
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setCredentialToDelete(credential.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
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
        <DialogContent className="border-line bg-settings-dialog sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Credential</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this credential? This action cannot be undone and may
              affect running workspaces.
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
              className="gap-2"
            >
              {deleteCredential.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
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
