"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { LockKeyhole, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPath } from "@gitterm/schema/url";
import { trpc } from "@/utils/trpc";
import env from "@gitterm/env/web";
import type { AdminIntegrationsData } from "./use-admin-integrations";
import { settingsLabel } from "@/components/dashboard/settings/settings-page";
import { SectionHeading, StatusDot } from "@/components/dashboard/kit";
import { formPanel } from "../../_components/admin";

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
      toast.error(cause instanceof Error ? cause.message : "Couldn't configure Google issuer");
    }
  }

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Workload identity issuer"
        action={
          <Button
            variant="secondary"
            disabled={configure.isPending}
            onClick={save}
            className="gap-2"
          >
            {configured ? <RotateCw className="size-4" /> : <LockKeyhole className="size-4" />}
            {configure.isPending
              ? "Working..."
              : configured
                ? "Rotate signing key"
                : "Generate signing key"}
          </Button>
        }
      />
      <div className={`${formPanel} space-y-4`}>
        <p className="text-[13.5px] leading-relaxed text-fg-3">
          One identity for this deployment that users&apos; Google Cloud connections trust. No
          Google private key needed.
        </p>
        {configured ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-line py-3">
            <StatusDot tone="ok">Signing key stored, encrypted</StatusDot>
            <span className="font-mono text-[12.5px] text-fg-3">Key ID {configured.keyId}</span>
          </div>
        ) : (
          <p className="text-[13px] text-fg-3">
            Generate a signing key here. Deployments configured through env keep working until you
            migrate.
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="google-issuer" className={settingsLabel}>
            Public issuer URL
          </Label>
          <Input
            id="google-issuer"
            value={configured?.issuer ?? issuer}
            onChange={(e) => setIssuer(e.target.value)}
            disabled={!!configured}
            className="font-mono text-[13px]"
          />
          <p className="text-[13px] leading-relaxed text-fg-3">
            The publicly reachable API URL followed by{" "}
            <code className="font-mono text-fg-2">/api/workload-identity</code>. Do not change the
            issuer after connecting Google projects; rotating keeps the old public key available
            briefly.
          </p>
        </div>
      </div>
    </section>
  );
}
