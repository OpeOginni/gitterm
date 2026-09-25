"use client";

import { useState } from "react";
import { Check, Copy, Radio } from "lucide-react";
import { toast } from "sonner";
import env from "@gitterm/env/web";

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

export function ProviderWebhookGuide({
  providerKey,
  providerName,
}: {
  providerKey: string;
  providerName: string;
}) {
  const [copied, setCopied] = useState(false);
  const setup = WEBHOOK_SETUPS[providerKey.toLowerCase()];
  if (!setup) return null;

  const listenerUrl = env.NEXT_PUBLIC_LISTENER_URL?.replace(/\/+$/, "");
  const webhookUrl = `${listenerUrl || "https://<your-listener-url>"}/trpc/${setup.route}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy the webhook URL");
    }
  }

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-4">
      <div className="flex items-center gap-2">
        <Radio className="size-4 text-amber-300" />
        <p className="text-sm font-medium text-foreground/90">
          Webhooks required for workspace status
        </p>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        GitTerm learns when {providerName} workspaces start, stop, or fail through webhooks. These
        are received by the <span className="text-foreground/80">listener</span> service, not the
        API. Make sure the listener is deployed and publicly reachable, then register a webhook in{" "}
        {setup.where}. Without it, workspaces can stay stuck in their previous status.
      </p>

      <div className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300/80">
          webhook url
        </p>
        <div className="flex items-stretch gap-2">
          <pre className="flex-1 overflow-x-auto rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2 text-[11px] leading-relaxed text-foreground/85">
            <code>{webhookUrl}</code>
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Webhook URL copied" : "Copy webhook URL"}
            className="inline-flex w-9 shrink-0 items-center justify-center rounded-lg border border-amber-400/20 text-muted-foreground transition-colors hover:text-foreground"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-300" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        </div>
        {!listenerUrl && (
          <p className="text-[11px] text-amber-300">
            NEXT_PUBLIC_LISTENER_URL is not set, so replace the placeholder with your listener's
            public URL.
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          Behind the bundled proxy, the listener is also reachable at{" "}
          <code className="text-foreground/80">
            https://&lt;your-domain&gt;/listener/trpc/{setup.route}
          </code>
          .
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300/80">
          subscribe to
        </p>
        <div className="flex flex-wrap gap-1.5">
          {setup.events.map((event) => (
            <span
              key={event}
              className="rounded-md border border-amber-400/20 px-2 py-0.5 font-mono text-[10.5px] text-foreground/80"
            >
              {event}
            </span>
          ))}
        </div>
      </div>

      {setup.secretNote && (
        <p className="text-xs leading-relaxed text-muted-foreground">{setup.secretNote}</p>
      )}
    </div>
  );
}
