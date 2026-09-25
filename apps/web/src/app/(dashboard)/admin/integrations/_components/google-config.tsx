"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, LockKeyhole, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPath } from "@gitterm/schema/url";
import { trpc } from "@/utils/trpc";
import env from "@gitterm/env/web";
import type { AdminIntegrationsData } from "./use-admin-integrations";
import { SectionCard } from "./ui";

type Props = {
  data: AdminIntegrationsData;
  refresh: () => Promise<void>;
};

export function GoogleConfig({ data, refresh }: Props) {
  const [issuer, setIssuer] = useState(
    apiPath(env.NEXT_PUBLIC_SERVER_URL || "https://api.gitterm.dev", "workload-identity"),
  );
  const configure = useMutation(trpc.admin.integrations.configureGoogle.mutationOptions());
  const configured = data.google;

  async function save() {
    const rotate = !!configured;
    if (
      rotate &&
      !window.confirm(
        "Rotate the deployment-wide Google signing key? Existing tokens may need to refresh.",
      )
    )
      return;
    try {
      await configure.mutateAsync({ issuer: configured?.issuer ?? issuer, rotate });
      await refresh();
      toast.success(rotate ? "Google signing key rotated" : "Google issuer configured");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn’t configure Google issuer");
    }
  }

  return (
    <SectionCard
      icon={LockKeyhole}
      title="Workload identity issuer"
      description="Deployment-wide identity used by users’ Google Cloud connections. No Google private key is needed."
      action={
        <Button
          disabled={configure.isPending}
          onClick={save}
          className="gap-2 font-mono text-xs font-bold uppercase tracking-wider"
        >
          {configured ? <RotateCw className="size-4" /> : <LockKeyhole className="size-4" />}
          {configure.isPending
            ? "Working..."
            : configured
              ? "Rotate signing key"
              : "Generate signing key"}
        </Button>
      }
    >
      <div className="space-y-4">
        {configured ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-sm">
            <p className="flex items-center gap-2 text-emerald-400">
              <Check className="size-4" /> Signing key stored encrypted in GitTerm
            </p>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              Key ID: {configured.keyId}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Generate a signing key here. Existing deployments using env configuration continue to
            work until you migrate.
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="google-issuer">Public issuer URL</Label>
          <Input
            id="google-issuer"
            value={configured?.issuer ?? issuer}
            onChange={(e) => setIssuer(e.target.value)}
            disabled={!!configured}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            The publicly reachable API URL followed by{" "}
            <code className="text-foreground/80">/api/workload-identity</code>. Do not change the
            issuer after connecting Google projects; rotating keeps the old public key available
            briefly.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
