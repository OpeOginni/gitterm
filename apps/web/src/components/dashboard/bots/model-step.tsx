"use client";

import { useState } from "react";
import { Key, Plus, UserRound } from "lucide-react";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiKeyDialog } from "../model-credentials/api-key-dialog";
import { ConnectAccountDialog } from "../model-credentials/connect-account-dialog";
import { ProviderLogo } from "../model-credentials/provider-logo";
import type { ModelCredential, ModelProvider } from "../model-credentials/types";

const refresh = () =>
  void queryClient.invalidateQueries({
    queryKey: trpc.modelCredentials.listMyCredentials.queryKey(),
  });

const fieldLabelClass = "text-[13px] font-medium text-fg-2";

export function ModelStepBody({
  isLoading,
  providers,
  credentials,
  credential,
  onCredentialChange,
  model,
  onModelChange,
  modelProblem,
}: {
  isLoading: boolean;
  providers: ModelProvider[];
  /** Every saved credential, so the dialogs can suggest free labels. */
  credentials: ModelCredential[];
  credential: ModelCredential | undefined;
  onCredentialChange: (id: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  modelProblem: string | null;
}) {
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const active = credentials.filter((candidate) => candidate.isActive);
  const hasOauth = providers.some((provider) => provider.authType === "oauth");
  const addButtons = (
    <div className="flex flex-wrap justify-center gap-2">
      <Button className="gap-2" onClick={() => setApiKeyOpen(true)}>
        <Key className="size-3.5" />
        Add API key
      </Button>
      {hasOauth ? (
        <Button variant="outline" className="gap-2" onClick={() => setConnectOpen(true)}>
          <UserRound className="size-3.5" />
          Add a subscription
        </Button>
      ) : null}
    </div>
  );

  return (
    <>
      {isLoading ? (
        <Skeleton className="h-16 w-full bg-fill" />
      ) : active.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-line-2 px-4 py-7 text-center">
          <p className="max-w-md text-[13.5px] leading-relaxed text-fg-2">
            Add an API key or connect a subscription you already pay for. The agent runs on it.
          </p>
          {addButtons}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label className={fieldLabelClass}>Credential</Label>
              <Select value={credential?.id} onValueChange={onCredentialChange}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Choose a credential" />
                </SelectTrigger>
                <SelectContent>
                  {active.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      <ProviderLogo
                        name={candidate.providerName}
                        displayName={candidate.providerDisplayName}
                        size={14}
                      />
                      <span className="truncate">
                        {candidate.providerDisplayName} · {candidate.label}
                      </span>
                      {candidate.isDefault ? (
                        <span className="text-[12.5px] text-fg-4">Default</span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bot-model" className={fieldLabelClass}>
                Model ID
              </Label>
              <Input
                id="bot-model"
                value={model}
                onChange={(event) => onModelChange(event.target.value)}
                placeholder="provider/model"
                className="h-10 font-mono"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!modelProblem}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {modelProblem ? <p className="text-[13px] text-destructive">{modelProblem}</p> : null}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto gap-1.5 text-fg-3"
              onClick={() => setApiKeyOpen(true)}
            >
              <Plus className="size-3.5" />
              Add another key
            </Button>
          </div>
        </div>
      )}

      <ApiKeyDialog
        open={apiKeyOpen}
        onOpenChange={setApiKeyOpen}
        providers={providers}
        credentials={credentials}
        onSaved={refresh}
      />
      <ConnectAccountDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        providers={providers}
        credentials={credentials}
        onConnected={refresh}
      />
    </>
  );
}
