"use client";

import { useState, useEffect, useCallback } from "react";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  Check,
  ExternalLink,
  Key,
  Loader2,
  MoreHorizontal,
  Plus,
  Shield,
  Trash2,
  RefreshCw,
  Copy,
  FileJson,
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
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { useTheme } from "next-themes";

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
  lastUsedAt: string | null;
  oauthExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Auth.json structure from OpenCode CLI
interface AuthJsonEntry {
  type: "oauth";
  refresh: string;
  access?: string;
  expires?: number;
  accountId?: string;
}

interface AuthJson {
  [key: string]: AuthJsonEntry;
}

// Helper to get provider logo path - logos are named after the provider name
const getProviderLogo = (providerName: string): string => {
  return `/${providerName}.svg`;
};

// Helper to check if a provider is recommended
const isProviderRecommended = (providerName: string, providers: Provider[]): boolean => {
  const provider = providers.find((p) => p.name === providerName);
  return provider?.isRecommended ?? false;
};

export function ModelCredentialsSection() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [credentialToDelete, setCredentialToDelete] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [authJsonInput, setAuthJsonInput] = useState("");
  const [authJsonError, setAuthJsonError] = useState<string | null>(null);

  // Theme for CodeMirror
  const { theme } = useTheme();

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
    trpc.modelCredentials.listProviders.queryOptions()
  );

  const { data: credentialsData, isLoading: isLoadingCredentials } = useQuery(
    trpc.modelCredentials.listMyCredentials.queryOptions()
  );

  const providers = (providersData?.providers ?? []) as Provider[];
  const credentials = (credentialsData?.credentials ?? []) as Credential[];

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);
  const isCodexProvider = selectedProvider?.plugin === "codex-auth";

  // Get the best default provider (prefer recommended, then first)
  const getDefaultProvider = useCallback(() => {
    if (providers.length === 0) return undefined;
    // Prefer recommended providers, specifically look for "opencode-zen" first
    const zenProvider = providers.find((p) => p.name === "opencode-zen");
    if (zenProvider) return zenProvider;
    const recommended = providers.find((p) => p.isRecommended);
    if (recommended) return recommended;
    return providers[0];
  }, [providers]);

  // Set default provider when data loads
  useEffect(() => {
    if (!selectedProviderId && providers.length > 0) {
      const defaultProvider = getDefaultProvider();
      if (defaultProvider) {
        setSelectedProviderId(defaultProvider.id);
      }
    }
  }, [providers, selectedProviderId, getDefaultProvider]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!addDialogOpen) {
      setApiKey("");
      setLabel("");
      setAuthJsonInput("");
      setAuthJsonError(null);
      setOauthStep("idle");
      setDeviceCode(null);
      const defaultProvider = getDefaultProvider();
      if (defaultProvider) {
        setSelectedProviderId(defaultProvider.id);
      }
    }
  }, [addDialogOpen, getDefaultProvider]);

  // Validate auth.json as user types
  useEffect(() => {
    if (!authJsonInput.trim()) {
      setAuthJsonError(null);
      return;
    }
    try {
      const parsed = JSON.parse(authJsonInput) as AuthJson;
      
      // Look for openai key (could be "openai" or the tokens directly)
      let entry: AuthJsonEntry | undefined;
      
      if (parsed.openai && parsed.openai.type === "oauth") {
        entry = parsed.openai;
      } else if ((parsed as unknown as AuthJsonEntry).type === "oauth") {
        entry = parsed as unknown as AuthJsonEntry;
      }

      if (!entry) {
        setAuthJsonError("Missing OpenAI OAuth tokens");
        return;
      }

      if (!entry.refresh) {
        setAuthJsonError("Missing refresh token");
        return;
      }

      setAuthJsonError(null);
    } catch {
      setAuthJsonError("Invalid JSON format");
    }
  }, [authJsonInput]);

  const invalidateCredentials = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: trpc.modelCredentials.listMyCredentials.queryKey(),
    });
  }, []);

  // Mutations
  const storeApiKeyMutation = useMutation(
    trpc.modelCredentials.storeApiKey.mutationOptions({
      onSuccess: () => {
        toast.success("API key saved securely");
        setAddDialogOpen(false);
        invalidateCredentials();
      },
      onError: (error) => {
        toast.error(`Failed to save API key: ${error.message}`);
      },
    })
  );

  const storeOAuthTokensMutation = useMutation(
    trpc.modelCredentials.storeOAuthTokens.mutationOptions({
      onSuccess: () => {
        toast.success("OpenAI Codex tokens saved successfully");
        setAddDialogOpen(false);
        invalidateCredentials();
      },
      onError: (error) => {
        toast.error(`Failed to save tokens: ${error.message}`);
      },
    })
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
    })
  );

  const pollOAuthMutation = useMutation(
    trpc.modelCredentials.pollOAuth.mutationOptions({
      onSuccess: (data) => {
        if (data.status === "success" && "accessToken" in data) {
          // Complete the OAuth flow
          completeOAuthMutation.mutate({
            providerName: selectedProvider?.name ?? "",
            accessToken: data.accessToken,
            label: label || undefined,
          });
        } else if (data.status === "pending") {
          // Keep polling
          setTimeout(() => {
            if (deviceCode) {
              pollOAuthMutation.mutate({
                deviceCode: deviceCode.deviceCode,
                providerName: selectedProvider?.name ?? "",
              });
            }
          }, (deviceCode?.interval ?? 5) * 1000);
        } else if (data.status === "slow_down") {
          // Slow down polling
          setTimeout(() => {
            if (deviceCode) {
              pollOAuthMutation.mutate({
                deviceCode: deviceCode.deviceCode,
                providerName: selectedProvider?.name ?? "",
              });
            }
          }, ((deviceCode?.interval ?? 5) + 5) * 1000);
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
    })
  );

  const completeOAuthMutation = useMutation(
    trpc.modelCredentials.completeOAuth.mutationOptions({
      onSuccess: () => {
        toast.success("GitHub Copilot connected successfully");
        setAddDialogOpen(false);
        invalidateCredentials();
      },
      onError: (error) => {
        toast.error(`Failed to complete OAuth: ${error.message}`);
        setOauthStep("idle");
      },
    })
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
    })
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
    })
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

  const parseAndValidateAuthJson = (input: string): { refresh: string; access?: string; expires?: number } | null => {
    try {
      const parsed = JSON.parse(input) as AuthJson;
      
      // Look for openai key (could be "openai" or the tokens directly)
      let entry: AuthJsonEntry | undefined;
      
      if (parsed.openai && parsed.openai.type === "oauth") {
        entry = parsed.openai;
      } else if ((parsed as unknown as AuthJsonEntry).type === "oauth") {
        // User might have pasted just the openai object
        entry = parsed as unknown as AuthJsonEntry;
      }

      if (!entry) {
        setAuthJsonError("Could not find OpenAI OAuth tokens. Make sure you copy the auth.json content from ~/.local/share/opencode/auth.json");
        return null;
      }

      if (!entry.refresh) {
        setAuthJsonError("Missing refresh token in auth.json");
        return null;
      }

      setAuthJsonError(null);
      return {
        refresh: entry.refresh,
        access: entry.access,
        expires: entry.expires,
      };
    } catch {
      setAuthJsonError("Invalid JSON format. Please paste the contents of your auth.json file.");
      return null;
    }
  };

  const handleSubmitAuthJson = () => {
    if (!authJsonInput.trim()) {
      toast.error("Please paste your auth.json content");
      return;
    }

    if (!selectedProvider) {
      toast.error("Please select a provider");
      return;
    }

    const tokens = parseAndValidateAuthJson(authJsonInput);
    if (!tokens) {
      return;
    }

    storeOAuthTokensMutation.mutate({
      providerName: selectedProvider.name,
      refreshToken: tokens.refresh,
      accessToken: tokens.access,
      expiresAt: tokens.expires,
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
    storeOAuthTokensMutation.isPending ||
    initiateOAuthMutation.isPending ||
    completeOAuthMutation.isPending;

  return (
    <Card className="mb-4 border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Model Credentials</CardTitle>
          </div>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Credential
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto border-border/50 bg-card">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Add Model Credential
                </DialogTitle>
                <DialogDescription>
                  Add an API key or connect via OAuth to use AI models in automated agent runs.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-5 py-4">
                {/* Provider Selection */}
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">Provider</Label>
                  <Select
                    value={selectedProviderId}
                    onValueChange={setSelectedProviderId}
                    disabled={oauthStep !== "idle"}
                  >
                    <SelectTrigger className="bg-secondary/30 border-border/50">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Sort providers: recommended first, then alphabetically */}
                      {[...providers]
                        .sort((a, b) => {
                          if (a.isRecommended && !b.isRecommended) return -1;
                          if (!a.isRecommended && b.isRecommended) return 1;
                          return a.displayName.localeCompare(b.displayName);
                        })
                        .map((provider) => (
                        <SelectItem 
                          key={provider.id} 
                          value={provider.id}
                          className={provider.isRecommended ? "border-l-2 border-l-primary rounded-none" : ""}                  
                        >
                          <div className="flex items-center gap-2">
                            <Image
                              src={getProviderLogo(provider.name)}
                              alt={provider.displayName}
                              width={16}
                              height={16}
                              className="h-4 w-4"
                            />
                            {provider.displayName}
                            {provider.isRecommended && (
                              <span className="text-xs text-muted-foreground">Recommended</span>
                            )}
                            {provider.authType === "oauth" && (
                              <span className="text-xs text-muted-foreground/70">OAuth</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Label (optional) */}
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">Label (optional)</Label>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g., Work account, Personal, etc."
                    className="bg-secondary/30 border-border/50"
                    disabled={oauthStep !== "idle"}
                  />
                </div>

                {/* API Key Input (for api_key providers) */}
                {selectedProvider?.authType === "api_key" && (
                  <div className="grid gap-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Key className="h-4 w-4 text-muted-foreground" />
                      API Key
                    </Label>
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Enter your API key"
                      className="bg-secondary/30 border-border/50 font-mono"
                    />
                    <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 rounded-lg bg-muted/50">
                      <Shield className="h-4 w-4 shrink-0 mt-0.5 text-green-500" />
                      <p>
                        Your API key is encrypted at rest using AES-256-GCM and never exposed in
                        logs or UI after saving.
                      </p>
                    </div>
                  </div>
                )}

                {/* Codex Auth - Paste auth.json */}
                {selectedProvider?.authType === "oauth" && isCodexProvider && (
                  <div className="grid gap-4">
                    <div className="flex items-start gap-2 text-sm text-muted-foreground p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                      <FileJson className="h-4 w-4 shrink-0 mt-0.5 text-blue-500" />
                      <div>
                        <p className="font-medium text-blue-700 dark:text-blue-300 mb-1">
                          Paste tokens from OpenCode CLI
                        </p>
                        <p className="text-xs text-blue-600 dark:text-blue-400">
                          1. Run <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">opencode auth login</code> and authenticate with OpenAI (ChatGPT Pro/Plus)
                        </p>
                        <p className="text-xs text-blue-600 dark:text-blue-400">
                          2. Copy contents of <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">~/.local/share/opencode/auth.json</code>
                        </p>
                        <p className="text-xs text-blue-600 dark:text-blue-400">
                          3. Paste below
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <FileJson className="h-4 w-4 text-muted-foreground" />
                        auth.json contents
                      </Label>
                      <div className="rounded-md border border-border/50 overflow-hidden">
                        <CodeMirror
                          value={authJsonInput}
                          height="160px"
                          extensions={[json()]}
                          onChange={(value) => {
                            setAuthJsonInput(value);
                          }}
                          theme={theme as "light" | "dark"}
                          placeholder='{"openai": {"type": "oauth", "refresh": "...", "access": "...", "expires": ...}}'
                          basicSetup={{
                            lineNumbers: true,
                            foldGutter: true,
                          }}
                          className="text-sm"
                        />
                      </div>
                      {authJsonError ? (
                        <div className="flex items-center gap-1.5 text-xs text-red-500">
                          <AlertCircle className="h-3.5 w-3.5" />
                          {authJsonError}
                        </div>
                      ) : authJsonInput.trim() ? (
                        <div className="flex items-center gap-1.5 text-xs text-green-500">
                          <Check className="h-3.5 w-3.5" />
                          Valid JSON
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 rounded-lg bg-muted/50">
                      <Shield className="h-4 w-4 shrink-0 mt-0.5 text-green-500" />
                      <p>
                        Your tokens are encrypted at rest and will be automatically refreshed when needed.
                      </p>
                    </div>
                  </div>
                )}

                {/* GitHub Copilot OAuth Flow (Device Code) */}
                {selectedProvider?.authType === "oauth" && !isCodexProvider && (
                  <div className="grid gap-4">
                    {oauthStep === "idle" && (
                      <div className="flex flex-col items-center gap-4 p-6 rounded-lg bg-secondary/30 border border-border/50">
                        <p className="text-sm text-center text-muted-foreground">
                          Click below to connect your GitHub account for Copilot access.
                        </p>
                        <Button onClick={handleStartOAuth} disabled={initiateOAuthMutation.isPending}>
                          {initiateOAuthMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Starting...
                            </>
                          ) : (
                            <>
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Connect with GitHub
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    {/* Device Code Flow UI (GitHub Copilot) */}
                    {oauthStep === "pending" && deviceCode && (
                      <div className="flex flex-col items-center gap-4 p-6 rounded-lg bg-secondary/30 border border-border/50">
                        <p className="text-sm text-center">
                          Open this URL and enter the code below:
                        </p>
                        <a
                          href={deviceCode.verificationUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-1"
                        >
                          {deviceCode.verificationUri}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <div className="flex items-center gap-2">
                          <code className="text-2xl font-mono font-bold tracking-widest bg-muted px-4 py-2 rounded">
                            {deviceCode.userCode}
                          </code>
                          <Button variant="ghost" size="icon" onClick={handleCopyCode}>
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                        <Button onClick={handleStartPolling} className="gap-2">
                          <Check className="h-4 w-4" />
                          I've entered the code
                        </Button>
                      </div>
                    )}

                    {/* Device Code Polling UI */}
                    {oauthStep === "polling" && (
                      <div className="flex flex-col items-center gap-4 p-6 rounded-lg bg-secondary/30 border border-border/50">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-center text-muted-foreground">
                          Waiting for authorization...
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAddDialogOpen(false)}
                  className="border-border/50"
                >
                  Cancel
                </Button>
                {selectedProvider?.authType === "api_key" && (
                  <Button
                    onClick={handleSubmitApiKey}
                    disabled={isSubmitting || !apiKey.trim()}
                    className="gap-2"
                  >
                    {storeApiKeyMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Shield className="h-4 w-4" />
                        Save Securely
                      </>
                    )}
                  </Button>
                )}
                {selectedProvider?.authType === "oauth" && isCodexProvider && (
                  <Button
                    onClick={handleSubmitAuthJson}
                    disabled={isSubmitting || !authJsonInput.trim()}
                    className="gap-2"
                  >
                    {storeOAuthTokensMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Shield className="h-4 w-4" />
                        Save Tokens
                      </>
                    )}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <CardDescription>
          Store API keys and OAuth credentials for AI model providers. Credentials are encrypted and
          used for automated agent runs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoadingCredentials || isLoadingProviders ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : credentials.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Key className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No credentials saved</p>
            <p className="text-xs mt-1">
              Add your first credential to enable automated agent runs
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {credentials.map((credential) => {
              const isRecommended = isProviderRecommended(credential.providerName, providers);
              return (
              <div
                key={credential.id}
                className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                  credential.isActive
                    ? isRecommended 
                      ? "border-l-2 border-l-primary border-border/50 bg-secondary/20 hover:bg-secondary/30"
                      : "border-border/50 bg-secondary/20 hover:bg-secondary/30"
                    : "border-border/30 bg-muted/20 opacity-60"
                }`}
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
                      {isRecommended && credential.isActive && (
                        <span className="text-xs text-muted-foreground">Recommended</span>
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
                      {credential.authType === "oauth" && (
                        <span className="text-xs text-muted-foreground/70">OAuth</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">...{credential.keyHash.slice(-8)}</span>
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
                  <DropdownMenuContent align="end">
                    {credential.isActive && (
                      <DropdownMenuItem
                        onClick={() => revokeCredentialMutation.mutate({ credentialId: credential.id })}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Revoke
                      </DropdownMenuItem>
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
      </CardContent>

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
    </Card>
  );
}
