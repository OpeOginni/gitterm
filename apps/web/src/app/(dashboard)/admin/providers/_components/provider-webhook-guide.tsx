"use client";

import { Radio } from "lucide-react";
import env from "@gitterm/env/web";
import { CopyField } from "@/components/dashboard/copy-field";

type WebhookSetup = {
  route: string;
  where: string;
  events: string[];
  /** Where the signing secret goes, when the provider signs its webhooks. */
  secret?: string;
};

const WEBHOOK_SETUPS: Record<string, WebhookSetup> = {
  railway: {
    route: "railway.handleWebhook",
    where: "Railway → Project Settings → Webhooks",
    events: [
      "Deployment Deploying",
      "Deployment Deployed",
      "Deployment Failed",
      "Deployment Slept",
    ],
  },
  e2b: {
    route: "e2b.handleWebhook",
    where: "E2B dashboard → Webhooks",
    events: ["sandbox.lifecycle.paused", "sandbox.lifecycle.resumed", "sandbox.lifecycle.killed"],
    secret: "Same value as Webhook Secret below.",
  },
  daytona: {
    route: "daytona.handleWebhook",
    where: "Daytona dashboard → Webhooks",
    events: ["sandbox.created", "sandbox.state.updated"],
    secret: "Paste Daytona's signing secret into Webhook Signing Secret below. Required.",
  },
  boat: {
    route: "boat.handleWebhook",
    where: "Boat dashboard → Webhooks",
    events: ["Ready", "Error", "Archived", "Hydrated"],
    secret:
      "boat shows the whsec_ secret once; paste it into Webhook Signing Secret below. Required.",
  },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[64px_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="text-[13px] font-medium text-fg-2">{label}</dt>
      <dd className="min-w-0 space-y-1.5 text-[13px] text-fg-3">{children}</dd>
    </div>
  );
}

export function ProviderWebhookGuide({
  providerKey,
  providerName,
}: {
  providerKey: string;
  providerName: string;
}) {
  const setup = WEBHOOK_SETUPS[providerKey.toLowerCase()];
  if (!setup) return null;

  const listenerUrl = env.NEXT_PUBLIC_LISTENER_URL?.replace(/\/+$/, "");
  const webhookUrl = `${listenerUrl || "https://<your-listener-url>"}/trpc/${setup.route}`;

  return (
    <div className="mt-4 overflow-hidden rounded-xl bg-fill">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-4">
        <Radio className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-fg">Status webhook</p>
          <p className="text-[13px] text-fg-3">Keeps {providerName} workspace status in sync.</p>
        </div>
        <p className="text-[13px] text-fg-3">
          Add in <span className="text-fg-2">{setup.where}</span>
        </p>
      </div>

      <dl className="space-y-3.5 px-4 py-4">
        <Field label="URL">
          <CopyField value={webhookUrl} placeholder={!listenerUrl} />
          {!listenerUrl && (
            <p className="text-[#fb923c]">
              Set <code className="font-mono">NEXT_PUBLIC_LISTENER_URL</code> to your
              listener&apos;s public URL.
            </p>
          )}
        </Field>
        <Field label="Events">
          <div className="flex flex-wrap gap-1.5">
            {setup.events.map((event) => (
              <span
                key={event}
                className="rounded-md bg-fill-2 px-2 py-0.5 font-mono text-[12.5px] text-fg-2"
              >
                {event}
              </span>
            ))}
          </div>
        </Field>
        {setup.secret && (
          <Field label="Secret">
            <p>{setup.secret}</p>
          </Field>
        )}
      </dl>
    </div>
  );
}
