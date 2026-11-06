"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { ProviderLogo } from "./provider-logo";
import { isLabelTaken, suggestLabel, type ModelCredential, type ModelProvider } from "./types";

/** Subscriptions first, in the order people most often have them. */
const ORDER = ["opencode-console", "openai-oauth", "github-copilot", "xai-oauth"];

type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
};

type Step =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; device: DeviceCode }
  | { kind: "failed"; message: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function ConnectAccountDialog({
  open,
  onOpenChange,
  ...props
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ModelProvider[];
  credentials: ModelCredential[];
  onConnected: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 bg-card p-0 sm:max-w-[560px]">
        {/* Mounted per open: closing the dialog also stops any polling. */}
        <ConnectAccountFlow {...props} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ConnectAccountFlow({
  providers,
  credentials,
  onConnected,
  onClose,
}: {
  providers: ModelProvider[];
  credentials: ModelCredential[];
  onConnected: () => void;
  onClose: () => void;
}) {
  const accounts = useMemo(
    () =>
      providers
        .filter((provider) => provider.authType === "oauth")
        .toSorted((a, b) => {
          const rank = (name: string) => {
            const index = ORDER.indexOf(name);
            return index === -1 ? ORDER.length : index;
          };
          return rank(a.name) - rank(b.name) || a.displayName.localeCompare(b.displayName);
        }),
    [providers],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = accounts.find((provider) => provider.id === selectedId);
  const [label, setLabel] = useState("");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  // Bumped to abandon an in-flight polling loop (back, retry, or unmount).
  const session = useRef(0);

  useEffect(
    () => () => {
      session.current += 1;
    },
    [],
  );

  const initiate = useMutation(trpc.modelCredentials.initiateOAuth.mutationOptions());
  const poll = useMutation(trpc.modelCredentials.pollOAuth.mutationOptions());
  const complete = useMutation(trpc.modelCredentials.completeOAuth.mutationOptions());

  const choose = (provider: ModelProvider | null) => {
    session.current += 1;
    setSelectedId(provider?.id ?? null);
    setLabel(provider ? suggestLabel(credentials, provider.id) : "");
    setStep({ kind: "idle" });
  };

  const labelTaken = isLabelTaken(credentials, selected?.id, label);

  const connect = async () => {
    if (!selected || !label.trim() || labelTaken) return;
    const id = ++session.current;
    const providerName = selected.name;
    const trimmed = label.trim();
    const live = () => session.current === id;
    setStep({ kind: "starting" });

    try {
      const device = await initiate.mutateAsync({ providerName });
      if (!live()) return;
      setStep({ kind: "waiting", device });

      const deadline = Date.now() + device.expiresIn * 1000;
      let interval = Math.max(device.interval, 1);
      while (live()) {
        await sleep(interval * 1000);
        if (!live()) return;
        if (Date.now() > deadline) {
          setStep({ kind: "failed", message: "The code expired. Start again to get a new one." });
          return;
        }
        const result = await poll.mutateAsync({
          providerName,
          deviceCode: device.deviceCode,
          label: trimmed,
        });
        if (!live()) return;
        if (result.status === "pending") continue;
        if (result.status === "slow_down") {
          interval += 5;
          continue;
        }
        if (result.status === "failed") {
          setStep({ kind: "failed", message: result.error ?? "Authorization failed" });
          return;
        }
        if ("accessToken" in result) {
          await complete.mutateAsync({
            providerName,
            accessToken: result.accessToken,
            label: trimmed,
          });
        }
        if (!live()) return;
        track("model_provider_connected", { provider: providerName, auth_type: "oauth" });
        toast.success(`${selected.displayName} connected`);
        onConnected();
        onClose();
        return;
      }
    } catch (error) {
      if (live()) {
        setStep({
          kind: "failed",
          message: error instanceof Error ? error.message : "Something went wrong",
        });
      }
    }
  };

  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-4 sm:px-6">
        <DialogTitle>
          {selected ? `Connect ${selected.displayName}` : "Connect an account"}
        </DialogTitle>
        <DialogDescription>
          Sign in with a subscription. Your credentials are encrypted and only used for your
          workspaces.
        </DialogDescription>
      </DialogHeader>

      {!selected ? (
        <div className="px-3 pb-4 sm:px-4">
          <div className="max-h-[26rem] space-y-0.5 overflow-y-auto">
            {accounts.map((provider) => {
              const connected = credentials.filter(
                (credential) => credential.providerId === provider.id && credential.isActive,
              ).length;
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => choose(provider)}
                  className="group flex w-full items-center gap-3.5 rounded-xl px-2 py-3 text-left transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none sm:px-2.5"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fill-2">
                    <ProviderLogo
                      name={provider.name}
                      displayName={provider.displayName}
                      size={20}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium text-fg">
                      {provider.displayName}
                    </span>
                    {provider.description ? (
                      <span className="mt-0.5 block text-[13px] text-fg-3 sm:truncate">
                        {provider.description}
                      </span>
                    ) : null}
                  </span>
                  {connected > 0 ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-md bg-[#6bd586]/10 px-2 py-0.5 text-[12.5px] font-medium text-[#6bd586]">
                      <Check className="size-3.5" />
                      {connected} connected
                    </span>
                  ) : null}
                  <ChevronRight className="size-4 shrink-0 text-fg-4 transition-transform group-hover:translate-x-0.5" />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 px-5 pb-5 sm:px-6">
          <button
            type="button"
            onClick={() => choose(null)}
            className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-3 transition-colors hover:text-fg"
          >
            <ArrowLeft className="size-4" />
            All accounts
          </button>

          {step.kind === "waiting" ? (
            <DeviceCodePanel device={step.device} providerName={selected.displayName} />
          ) : (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="account-label" className="text-[13px] text-fg-2">
                  Label
                </Label>
                <Input
                  id="account-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="default, work, personal"
                  disabled={step.kind === "starting"}
                  aria-invalid={labelTaken}
                />
                <p className={cn("text-[12.5px] text-fg-4", labelTaken && "text-red-300")}>
                  {labelTaken
                    ? `You already have a ${selected.displayName} account called "${label.trim()}".`
                    : "Tells accounts for the same provider apart in workspaces and the SDK."}
                </p>
              </div>

              {step.kind === "failed" && (
                <p className="rounded-xl bg-red-500/10 px-3 py-2.5 text-[13px] text-red-300">
                  {step.message}
                </p>
              )}

              <Button
                type="submit"
                disabled={!label.trim() || labelTaken || step.kind === "starting"}
              >
                {step.kind === "starting" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Getting a code...
                  </>
                ) : step.kind === "failed" ? (
                  "Try again"
                ) : (
                  `Continue with ${selected.displayName}`
                )}
              </Button>
            </form>
          )}
        </div>
      )}

      <DialogFooter className="m-0">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

function DeviceCodePanel({ device, providerName }: { device: DeviceCode; providerName: string }) {
  const host = (() => {
    try {
      return new URL(device.verificationUri).host;
    } catch {
      return providerName;
    }
  })();

  const copy = () => {
    void navigator.clipboard.writeText(device.userCode);
    toast.success("Code copied");
  };

  return (
    <div className="grid gap-4">
      <ol className="grid gap-4">
        <li className="grid gap-2">
          <p className="text-[13px] text-fg-2">
            <span className="mr-2 text-fg-4">1.</span>
            Open {host} and sign in.
          </p>
          <Button asChild className="w-full">
            <a href={device.verificationUri} target="_blank" rel="noopener noreferrer">
              Open {host}
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </li>
        <li className="grid gap-2">
          <p className="text-[13px] text-fg-2">
            <span className="mr-2 text-fg-4">2.</span>
            Confirm this code when asked.
          </p>
          <div className="flex h-12 items-center rounded-xl bg-fill-2 pr-1.5 pl-4">
            <code className="min-w-0 flex-1 truncate font-mono text-lg font-semibold tracking-[0.22em] text-fg">
              {device.userCode}
            </code>
            <button
              type="button"
              onClick={copy}
              aria-label="Copy code"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-fill-2 hover:text-fg"
            >
              <Copy className="size-4" />
            </button>
          </div>
        </li>
      </ol>
      <div className="flex items-center gap-2 text-[12.5px] text-fg-3" role="status">
        <Loader2 className="size-4 animate-spin text-primary" />
        Waiting for approval. This finishes on its own.
      </div>
    </div>
  );
}
