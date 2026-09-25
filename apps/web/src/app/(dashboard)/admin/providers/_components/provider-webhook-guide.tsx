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
  secretNote?: string;
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
    where: "E2B dashboard → Webhooks (sandbox lifecycle)",
    events: ["sandbox.lifecycle.paused", "sandbox.lifecycle.resumed", "sandbox.lifecycle.killed"],
    secretNote: "Use the same signature secret you save as Webhook Secret below.",
  },
  daytona: {
    route: "daytona.handleWebhook",
    where: "Daytona dashboard → Webhooks",
    events: ["sandbox.created", "sandbox.state.updated"],
    secretNote:
      "Copy the endpoint's signing secret from Daytona into Webhook Signing Secret below. Webhooks are rejected without it.",
  },
};

function Step({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 font-mono text-[10px] font-semibold text-primary">
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-2 text-xs leading-relaxed text-muted-foreground">
        {children}
      </div>
    </li>
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
    <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-fill">
      <code
        className={cn(
          "min-w-0 flex-1 overflow-x-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-nowrap",
          placeholder ? "text-muted-foreground" : "text-foreground/85",
        )}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Webhook URL copied" : "Copy webhook URL"}
        className="flex w-9 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-fill-2 hover:text-foreground"
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
    <div className="relative mt-4 overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-b from-primary/[0.07] to-transparent p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative flex items-start gap-3">
        <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <Radio className="size-4" />
          <span className="absolute inset-0 animate-ping rounded-lg border border-primary/20 [animation-duration:2.4s] motion-reduce:hidden" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground/90">
            Webhooks keep workspace status live
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            GitTerm learns when {providerName} workspaces start, stop, or fail through webhooks
            delivered to the <span className="text-foreground/80">listener</span> service, not the
            API. Without them, workspaces can stay stuck in their previous status.
          </p>
        </div>
      </div>

      <ol className="relative mt-4 space-y-3.5">
        <Step number={1}>
          <p>
            Deploy the listener and make it reachable from the internet. Behind the bundled proxy it
            also answers at{" "}
            <code className="text-foreground/80">
              https://&lt;your-domain&gt;/listener/trpc/{setup.route}
            </code>
            .
          </p>
        </Step>
        <Step number={2}>
          <p>
            In <span className="text-foreground/80">{setup.where}</span>, add a webhook with this
            URL:
          </p>
          <CopyField value={webhookUrl} placeholder={!listenerUrl} />
          {!listenerUrl && (
            <p className="text-[11px] text-primary">
              NEXT_PUBLIC_LISTENER_URL is not set. Replace the placeholder with your listener's
              public URL.
            </p>
          )}
        </Step>
        <Step number={3}>
          <p>Subscribe to these events:</p>
          <div className="flex flex-wrap gap-1.5">
            {setup.events.map((event) => (
              <span
                key={event}
                className="rounded-md border border-border bg-fill px-2 py-0.5 font-mono text-[10.5px] text-foreground/80"
              >
                {event}
              </span>
            ))}
          </div>
          {setup.secretNote && <p>{setup.secretNote}</p>}
        </Step>
      </ol>
    </div>
  );
}
