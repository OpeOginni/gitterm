"use client";

import { useState, useEffect, useCallback } from "react";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { SettingsSection, SettingsSectionBody } from "@/components/ui/form-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Check,
  ExternalLink,
  Key,
  Loader2,
  MoreHorizontal,
  Plus,
  Shield,
  Star,
  Trash2,
  RefreshCw,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { track } from "@/lib/analytics";

type AuthType = "api_key" | "oauth";

interface Provider {
  id: string;
  name: string;
  displayName: string;
  authType: AuthType;
  plugin?: string;
  isRecommended?: boolean;
}

interface Credential {
  id: string;
  providerId: string;
  providerName: string;
  providerDisplayName: string;
  authType: string;
  label: string | null;
  keyHash: string;
  isActive: boolean;
  isDefault: boolean;
  logicalProviderKey: string;
  lastUsedAt: string | null;
  oauthExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Helper to get provider logo path - logos are named after the provider name
const getProviderLogo = (providerName: string): string => {
  if (providerName === "openai-oauth") return "/openai.svg";
  return `/${providerName}.svg`;
};

export function ModelCredentialsSection() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [credentialToDelete, setCredentialToDelete] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");

  // OAuth state (for device code flow - GitHub Copilot)
  const [oauthStep, setOauthStep] = useState<"idle" | "pending" | "polling">("idle");
  const [deviceCode, setDeviceCode] = useState<{
    verificationUri: string;
    userCode: string;
    deviceCode: string;
    interval: number;
    expiresIn: number;
  } | null>(null);

  // Queries
  const { data: providersData, isLoading: isLoadingProviders } = useQuery(
    trpc.modelCredentials.listProviders.queryOptions(),
  );

  const { data: credentialsData, isLoading: isLoadingCredentials } = useQuery(
    trpc.modelCredentials.listMyCredentials.queryOptions(),
  );

  const providers = (providersData?.providers ?? []) as Provider[];
  const credentials = (credentialsData?.credentials ?? []) as Credential[];

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);
  const isOAuthProvider = selectedProvider?.plugin === "oauth";
  const openAIProvider = providers.find((provider) => provider.name === "openai");
  const openAIOAuthProvider = providers.find((provider) => provider.plugin === "oauth");
  const visibleProviders = providers.filter((provider) => provider.plugin !== "oauth");

  // Get the best default provider (prefer recommended, then first)
  const getDefaultProvider = useCallback(() => {
    if (providers.length === 0) return undefined;
    // Prefer recommended providers, specifically look for "opencode-zen" first
    const zenProvider = providers.find((p) => p.name === "opencode-zen");
    if (zenProvider) return zenProvider;
    const recommended = providers.find((p) => p.isRecommended);
    if (recommended) return recommended;
    return providers[0];
  }, [providers, providers.length]);

  // Set default provider when data loads
  useEffect(() => {
    if (!selectedProviderId && providers.length > 0) {
      const defaultProvider = getDefaultProvider();
      if (defaultProvider) {
        setSelectedProviderId(defaultProvider.id);
      }
    }
  }, [selectedProviderId, getDefaultProvider, providers.length]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!addDialogOpen) {
      const resetTimer = window.setTimeout(() => {
        setApiKey("");
        setLabel("");
        setOauthStep("idle");
        setDeviceCode(null);
        const defaultProvider = getDefaultProvider();
        if (defaultProvider) {
          setSelectedProviderId(defaultProvider.id);
        }
      }, 250);

      return () => window.clearTimeout(resetTimer);
    }
  }, [addDialogOpen, getDefaultProvider]);

  const invalidateCredentials = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: trpc.modelCredentials.listMyCredentials.queryKey(),
    });
  }, []);

  // Mutations
  const storeApiKeyMutation = useMutation(
    trpc.modelCredentials.storeApiKey.mutationOptions({
      onSuccess: () => {
        track("api_key_saved", { provider: selectedProvider?.name, auth_type: "api_key" });
        toast.success("API key saved");
        setAddDialogOpen(false);
        invalidateCredentials();
      },
      onError: (error) => {
        toast.error(`Failed to save API key: ${error.message}`);
      },
    }),
  );

  const initiateOAuthMutation = useMutation(
    trpc.modelCredentials.initiateOAuth.mutationOptions({
      onSuccess: (data) => {
        if (data.flowType === "device_code") {
          // Device code flow (GitHub Copilot)
          setDeviceCode({
            verificationUri: data.verificationUri,
            userCode: data.userCode,
            deviceCode: data.deviceCode,
            interval: data.interval,
            expiresIn: data.expiresIn,
          });
          setOauthStep("pending");
        }
      },
      onError: (error) => {
        toast.error(`Failed to start OAuth: ${error.message}`);
        setOauthStep("idle");
      },
    }),
  );

  const pollOAuthMutation = useMutation(
    trpc.modelCredentials.pollOAuth.mutationOptions({
      onSuccess: (data) => {
        if (data.status === "success") {
          if (isOAuthProvider) {
            toast.success("ChatGPT account connected");
            setAddDialogOpen(false);
            invalidateCredentials();
          } else if ("accessToken" in data)
            completeOAuthMutation.mutate({
              providerName: selectedProvider?.name ?? "",
              accessToken: data.accessToken,
              label: label || undefined,
            });
        } else if (data.status === "pending") {
          // Keep polling
          setTimeout(
            () => {
              if (deviceCode) {
                pollOAuthMutation.mutate({
                  deviceCode: deviceCode.deviceCode,
                  providerName: selectedProvider?.name ?? "",
                  label: label || undefined,
                });
              }
            },
            (deviceCode?.interval ?? 5) * 1000,
          );
        } else if (data.status === "slow_down") {
          // Slow down polling
          setTimeout(
            () => {
              if (deviceCode) {
                pollOAuthMutation.mutate({
                  deviceCode: deviceCode.deviceCode,
                  providerName: selectedProvider?.name ?? "",
                  label: label || undefined,
                });
              }
            },
            ((deviceCode?.interval ?? 5) + 5) * 1000,
          );
        } else {
          const errorMsg = "error" in data ? data.error : "Unknown error";
          toast.error(`OAuth failed: ${errorMsg}`);
          setOauthStep("idle");
          setDeviceCode(null);
        }
      },
      onError: (error) => {
        toast.error(`OAuth polling failed: ${error.message}`);
        setOauthStep("idle");
      },
    }),
  );

  const completeOAuthMutation = useMutation(
    trpc.modelCredentials.completeOAuth.mutationOptions({
      onSuccess: () => {
        track("api_key_saved", { provider: selectedProvider?.name, auth_type: "oauth" });
        toast.success("GitHub Copilot connected successfully");
        setAddDialogOpen(false);
        invalidateCredentials();
      },
      onError: (error) => {
        toast.error(`Failed to complete OAuth: ${error.message}`);
        setOauthStep("idle");
      },
    }),
  );

  const revokeCredentialMutation = useMutation(
    trpc.modelCredentials.revokeCredential.mutationOptions({
      onSuccess: () => {
        toast.success("Credential revoked");
        invalidateCredentials();
      },
      onError: (error) => {
        toast.error(`Failed to revoke: ${error.message}`);
      },
    }),
  );

  const setDefaultCredentialMutation = useMutation(
    trpc.modelCredentials.setDefaultCredential.mutationOptions({
      onSuccess: () => {
        toast.success("Default credential updated");
        invalidateCredentials();
      },
      onError: (error) => toast.error(`Failed to update default: ${error.message}`),
    }),
  );

  const deleteCredentialMutation = useMutation(
    trpc.modelCredentials.deleteCredential.mutationOptions({
      onSuccess: () => {
        toast.success("Credential deleted");
        setDeleteDialogOpen(false);
        setCredentialToDelete(null);
        invalidateCredentials();
      },
      onError: (error) => {
        toast.error(`Failed to delete: ${error.message}`);
      },
    }),
  );

  const handleSubmitApiKey = () => {
    if (!apiKey.trim()) {
      toast.error("Please enter an API key");
      return;
    }

    if (!selectedProvider) {
      toast.error("Please select a provider");
      return;
    }

    storeApiKeyMutation.mutate({
      providerName: selectedProvider.name,
      apiKey: apiKey.trim(),
      label: label || undefined,
    });
  };

  const handleStartOAuth = () => {
    if (!selectedProvider) {
      toast.error("Please select a provider");
      return;
    }

    setOauthStep("polling");

    initiateOAuthMutation.mutate({
      providerName: selectedProvider.name,
    });
  };

  const handleStartPolling = () => {
    if (!deviceCode || !selectedProvider) return;

    setOauthStep("polling");
    pollOAuthMutation.mutate({
      deviceCode: deviceCode.deviceCode,
      providerName: selectedProvider.name,
      label: label || undefined,
    });
  };

  const handleCopyCode = () => {
    if (deviceCode) {
      navigator.clipboard.writeText(deviceCode.userCode);
      toast.success("Code copied to clipboard");
    }
  };

  const handleDeleteClick = (id: string) => {
    setCredentialToDelete(id);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (credentialToDelete) {
      deleteCredentialMutation.mutate({ credentialId: credentialToDelete });
    }
  };

  const isSubmitting =
    storeApiKeyMutation.isPending ||
    initiateOAuthMutation.isPending ||
    completeOAuthMutation.isPending;

  const addCredentialDialog = (
    <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2 font-mono text-[11px] uppercase tracking-[0.18em]">
          <Plus className="h-3.5 w-3.5" />
          Add credential
        </Button>
      </DialogTrigger>
      <DialogContent className="grid h-[min(700px,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-border bg-surface-2 p-0 sm:max-w-[760px]">
        <DialogHeader className="space-y-0 border-b border-white/[0.07] px-6 py-5 sm:px-7">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
            New / Credential
          </span>
          <div className="mt-3 flex items-center gap-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/[0.08]">
              {selectedProvider ? (
                <Image
                  src={getProviderLogo(selectedProvider.name)}
                  alt={selectedProvider.displayName}
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px]"
                />
              ) : (
                <Shield className="h-[18px] w-[18px] text-white/55" />
              )}
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-xl font-medium tracking-[-0.025em]">
                {selectedProvider
                  ? `Add ${selectedProvider.displayName} credential`
                  : "Add model credential"}
              </DialogTitle>
              <DialogDescription className="mt-0.5">
                {selectedProvider?.authType === "oauth" && isOAuthProvider
                  ? "Connect securely with your ChatGPT account."
                  : selectedProvider?.authType === "oauth"
                    ? "Connect via GitHub device code flow."
                    : "Store an API key for automated agent runs."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 overflow-y-auto sm:grid-cols-[220px_minmax(0,1fr)] sm:overflow-hidden">
          {/* Provider Selection -- horizontal scrollable chips */}
          <div className="border-b border-border bg-white/[0.015] p-4 sm:overflow-y-auto sm:border-r sm:border-b-0 sm:p-5">
            <Label className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
              Provider
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
              {[...visibleProviders]
                .toSorted((a, b) => {
                  if (a.isRecommended && !b.isRecommended) return -1;
                  if (!a.isRecommended && b.isRecommended) return 1;
                  return a.displayName.localeCompare(b.displayName);
                })
                .map((provider) => {
                  const isSelected =
                    selectedProviderId === provider.id ||
                    (provider.name === "openai" && isOAuthProvider);
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => setSelectedProviderId(provider.id)}
                      disabled={oauthStep !== "idle"}
                      className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm font-medium transition-all ${
                        isSelected
                          ? "border-primary/35 bg-primary/[0.09] text-white shadow-[inset_3px_0_0_hsl(var(--primary))]"
                          : "border-transparent text-white/50 hover:border-white/10 hover:bg-white/[0.035] hover:text-white/80"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <Image
                        src={getProviderLogo(provider.name)}
                        alt={provider.displayName}
                        width={16}
                        height={16}
                        className="h-4 w-4"
                      />
                      <span className="truncate">{provider.displayName}</span>
                      {provider.isRecommended && (
                        <span
                          className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                          title="Recommended"
                        >
                          <span className="sr-only">Recommended</span>
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>

          <div className="grid content-start gap-5 p-5 sm:overflow-y-auto sm:p-6">
            {(selectedProvider?.name === "openai" || isOAuthProvider) && (
              <div className="grid gap-2">
                <Label className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
                  Authentication
                </Label>
                <div className="grid grid-cols-2 rounded-xl border border-border bg-input/40 p-1">
                  <button
                    type="button"
                    onClick={() => openAIProvider && setSelectedProviderId(openAIProvider.id)}
                    className={`rounded-lg px-3 py-2.5 text-sm transition-colors ${!isOAuthProvider ? "bg-white/[0.09] text-white shadow-sm" : "text-white/45 hover:text-white/75"}`}
                  >
                    API key
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      openAIOAuthProvider && setSelectedProviderId(openAIOAuthProvider.id)
                    }
                    className={`rounded-lg px-3 py-2.5 text-sm transition-colors ${isOAuthProvider ? "bg-white/[0.09] text-white shadow-sm" : "text-white/45 hover:text-white/75"}`}
                  >
                    OAuth
                  </button>
                </div>
                <p className="text-[11px] leading-relaxed text-white/35">
                  {isOAuthProvider
                    ? "Uses your ChatGPT subscription. Tokens are encrypted and refreshed automatically."
                    : "Uses usage billed through your OpenAI API account."}
                </p>
              </div>
            )}
            {/* Label (optional) */}
            <div className="grid gap-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
                Label <span className="ml-1 normal-case text-white/30">(optional)</span>
              </Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g., Work account, Personal"
                disabled={oauthStep !== "idle"}
              />
            </div>

            {/* API Key Input (for api_key providers) */}
            {selectedProvider?.authType === "api_key" && (
              <div className="grid gap-2">
                <Label className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
                  API key
                </Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="font-mono"
                />
              </div>
            )}

            {/* GitHub Copilot OAuth Flow (Device Code) */}
            {selectedProvider?.authType === "oauth" && (
              <div className="grid gap-4">
                {oauthStep === "idle" && (
                  <div className="flex flex-col items-center gap-4 rounded-xl border border-white/[0.08] bg-input/40 p-8">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                      <ExternalLink className="h-5 w-5 text-primary" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium">
                        {isOAuthProvider ? "Connect your ChatGPT account" : "Connect with GitHub"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {isOAuthProvider
                          ? "Authorize OpenAI access with a one-time device code."
                          : "Authorize Copilot access via device code flow."}
                      </p>
                    </div>
                    <Button
                      onClick={handleStartOAuth}
                      disabled={initiateOAuthMutation.isPending}
                      className="gap-2"
                    >
                      {initiateOAuthMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        "Start Authorization"
                      )}
                    </Button>
                  </div>
                )}

                {oauthStep === "pending" && deviceCode && (
                  <div className="flex flex-col items-center gap-5 rounded-xl border border-white/[0.08] bg-input/40 p-8">
                    <p className="text-sm text-muted-foreground">
                      Open the link and enter this code:
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="rounded-lg bg-muted px-5 py-3 text-2xl font-mono font-bold tracking-[0.2em]">
                        {deviceCode.userCode}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleCopyCode}
                        className="h-8 w-8"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <a
                      href={deviceCode.verificationUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      {deviceCode.verificationUri}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <Button onClick={handleStartPolling} className="gap-2">
                      <Check className="h-4 w-4" />
                      I&apos;ve entered the code
                    </Button>
                  </div>
                )}

                {oauthStep === "polling" && (
                  <div className="flex flex-col items-center gap-4 rounded-xl border border-white/[0.08] bg-input/40 p-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Waiting for authorization...</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-border bg-white/[0.015] px-6 py-4">
          <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
            Cancel
          </Button>
          {selectedProvider?.authType === "api_key" && (
            <Button
              onClick={handleSubmitApiKey}
              disabled={isSubmitting || !apiKey.trim()}
              className="gap-2 font-mono text-[11px] uppercase tracking-[0.18em]"
            >
              {storeApiKeyMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save key"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <SettingsSection
        eyebrow="02 / Credentials"
        icon={Key}
        title="Model credentials"
        description="Bring your own keys. We never resell AI access, and your credentials are only injected into your workspaces."
        action={addCredentialDialog}
      >
        <SettingsSectionBody>
          {isLoadingCredentials || isLoadingProviders ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full bg-white/[0.04]" />
              <Skeleton className="h-14 w-full bg-white/[0.04]" />
            </div>
          ) : credentials.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl bg-input/40 px-6 py-10 text-center">
              <Key className="mb-3 h-8 w-8 text-white/25" />
              <p className="text-sm text-white/65">No credentials saved</p>
              <p className="mt-1 text-[12px] text-white/35">
                Add your first key to unlock automated agent runs.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {credentials.map((credential) => {
                return (
                  <div
                    key={credential.id}
                    className={`flex items-center justify-between gap-3 rounded-lg border border-transparent px-4 py-3 transition-colors ${credential.isActive ? "bg-input/60 hover:border-border hover:bg-input" : "bg-input/20 opacity-60"}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Image
                          src={getProviderLogo(credential.providerName)}
                          alt={credential.providerDisplayName}
                          width={20}
                          height={20}
                          className="h-5 w-5"
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{credential.providerDisplayName}</p>
                          {credential.isDefault && credential.isActive && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-primary/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-primary/80">
                              <Star className="h-2.5 w-2.5 fill-current" />
                              Default
                            </span>
                          )}
                          {credential.label && (
                            <Badge variant="outline" className="text-xs">
                              {credential.label}
                            </Badge>
                          )}
                          {!credential.isActive && (
                            <Badge variant="destructive" className="text-xs">
                              Revoked
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {credential.authType === "oauth" ? (
                            <span>Connected via OAuth</span>
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
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="border-border/90">
                        {credential.isActive && (
                          <>
                            {!credential.isDefault && (
                              <DropdownMenuItem
                                onClick={() =>
                                  setDefaultCredentialMutation.mutate({
                                    credentialId: credential.id,
                                  })
                                }
                              >
                                <Star className="mr-2 h-4 w-4" />
                                Make default
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() =>
                                revokeCredentialMutation.mutate({ credentialId: credential.id })
                              }
                            >
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Revoke
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleDeleteClick(credential.id)}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </SettingsSectionBody>
      </SettingsSection>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Credential</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this credential? This action cannot be undone and may
              affect running agent loops.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteCredentialMutation.isPending}
              className="gap-2"
            >
              {deleteCredentialMutation.isPending ? (
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
