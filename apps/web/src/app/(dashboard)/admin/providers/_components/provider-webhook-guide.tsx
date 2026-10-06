"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Radio } from "lucide-react";
import { toast } from "sonner";
import env from "@gitterm/env/web";
import { cn } from "@/lib/utils";

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
  ascii: {
    route: "ascii.handleWebhook",
    where: "boat dashboard → Webhooks",
    events: ["Ready", "Error", "Archived", "Hydrated"],
    secret:
      "boat shows the whsec_ secret once; paste it into Webhook Signing Secret below. Required.",
  },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[64px_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-4">{label}</dt>
      <dd className="min-w-0 space-y-1.5 text-xs text-fg-3">{children}</dd>
    </div>
  );
}

function CopyField({ value, placeholder }: { value: string; placeholder: boolean }) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy the webhook URL");
    }
  }

  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-line bg-fill">
      <code
        className={cn(
          "min-w-0 flex-1 overflow-x-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-nowrap",
          placeholder ? "text-fg-4" : "text-fg-2",
        )}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Webhook URL copied" : "Copy webhook URL"}
        className="flex w-9 shrink-0 items-center justify-center border-l border-line text-fg-4 transition-colors hover:bg-fill-2 hover:text-fg"
      >
        {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
      </button>
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
    <div className="mt-4 overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-fill px-4 py-3">
        <Radio className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">Status webhook</p>
          <p className="text-xs text-fg-4">Keeps {providerName} workspace status in sync.</p>
        </div>
        <p className="text-xs text-fg-3">
          Add in <span className="text-fg-2">{setup.where}</span>
        </p>
      </div>

      <dl className="space-y-3.5 px-4 py-4">
        <Field label="URL">
          <CopyField value={webhookUrl} placeholder={!listenerUrl} />
          {!listenerUrl && (
            <p className="text-amber-400">
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
                className="rounded-md border border-line bg-fill px-2 py-0.5 font-mono text-[10.5px] text-fg-2"
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
