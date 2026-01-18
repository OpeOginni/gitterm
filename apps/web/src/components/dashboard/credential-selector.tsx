"use client";

import { useEffect, useMemo, useRef } from "react";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
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
import { Key, Shield, AlertCircle, ExternalLink } from "lucide-react";
import Link from "next/link";

interface CredentialSelectorProps {
  /** Provider name (e.g., "anthropic", "openai") to filter credentials */
  providerName: string;
  /** Currently selected credential ID */
  value: string | undefined;
  /** Callback when selection changes */
  onChange: (credentialId: string | undefined) => void;
  /** Whether the selected model requires an API key (false for free models) */
  requiresCredential?: boolean;
  /** Disable the selector */
  disabled?: boolean;
  /** Show label */
  showLabel?: boolean;
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

/**
 * CredentialSelector - Select a stored credential for the given provider.
 * All credentials must be stored persistently in settings.
 */
export function CredentialSelector({
  providerName,
  value,
  onChange,
  requiresCredential = true,
  disabled = false,
  showLabel = true,
}: CredentialSelectorProps) {
  const { data: credentialsData, isLoading } = useQuery(
    trpc.modelCredentials.listMyCredentials.queryOptions(),
  );

  const allCredentials = (credentialsData?.credentials ?? []) as Credential[];

  // Track previous provider to detect changes
  const prevProviderRef = useRef(providerName);

  // Memoize filtered credentials to avoid unnecessary recalculations
  const providerCredentials = useMemo(
    () => allCredentials.filter((c) => c.providerName === providerName && c.isActive),
    [allCredentials, providerName],
  );

  const hasStoredCredentials = providerCredentials.length > 0;

  // Reset selection when provider changes
  useEffect(() => {
    if (prevProviderRef.current !== providerName) {
      // Provider changed - reset the credential selection
      prevProviderRef.current = providerName;
      onChange(undefined);
    }
  }, [providerName, onChange]);

  // Auto-select first credential if none selected and credentials exist for this provider
  useEffect(() => {
    // Only auto-select if value is undefined and we have credentials for this provider
    if (value === undefined && hasStoredCredentials && providerCredentials.length > 0) {
      // Verify the first credential is actually for this provider
      const firstCred = providerCredentials[0];
      if (firstCred.providerName === providerName) {
        onChange(firstCred.id);
      }
    }
  }, [value, hasStoredCredentials, providerCredentials, providerName, onChange]);

  // If no credential required (free model), show a simple message
  if (!requiresCredential) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
        <Shield className="h-4 w-4 text-green-500" />
        <p className="text-sm text-green-600 dark:text-green-400">
          This model is free and doesn't require an API key.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return <Skeleton className="h-10 w-full" />;
  }

  // No credentials stored - prompt user to add one
  if (!hasStoredCredentials) {
    return (
      <div className="flex flex-col gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              No API Key Configured
            </p>
            <p className="text-xs text-muted-foreground">
              You need to add an API key for {providerName} before running agent loops.
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium"
        >
          Add API Key in Settings
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {showLabel && (
        <Label className="text-sm font-medium flex items-center gap-2">
          <Key className="h-4 w-4 text-muted-foreground" />
          API Key
        </Label>
      )}
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="bg-secondary/50 border-border/50">
          <SelectValue placeholder="Select credential" />
        </SelectTrigger>
        <SelectContent>
          {providerCredentials.map((cred) => (
            <SelectItem key={cred.id} value={cred.id}>
              <div className="flex items-center gap-2">
                <span>{cred.providerDisplayName}</span>
                {cred.label && (
                  <Badge variant="outline" className="text-xs">
                    {cred.label}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground font-mono">
                  ...{cred.keyHash.slice(-6)}
                </span>
                {cred.authType === "oauth" && (
                  <Badge variant="secondary" className="text-xs">
                    OAuth
                  </Badge>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Your API key is stored securely and encrypted at rest.
      </p>
    </div>
  );
}

/**
 * Helper to check if a credential is selected (or not required)
 */
export function hasCredentialSelected(
  credentialId: string | undefined,
  requiresCredential: boolean,
): boolean {
  if (!requiresCredential) return true;
  return !!credentialId;
}

/**
 * Alias for backward compatibility
 */
export const isCredentialSelectionValid = hasCredentialSelected;
