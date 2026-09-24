"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AppWindow, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/utils/trpc";
import env from "@gitterm/env/web";
import type { AdminIntegrationsData } from "./use-admin-integrations";
import { SectionCard } from "./ui";

type Props = {
  data: AdminIntegrationsData;
  refresh: () => Promise<void>;
};

function ActiveBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <Badge
      variant="outline"
      className={
        active
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-[10px]"
          : "border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground text-[10px]"
      }
    >
      {label}
    </Badge>
  );
}

export function GithubConfig({ data, refresh }: Props) {
  const [appId, setAppId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [pat, setPat] = useState("");

  const configureApp = useMutation(trpc.admin.integrations.configureGithubApp.mutationOptions());
  const configurePat = useMutation(trpc.admin.integrations.configureGithubPat.mutationOptions());

  const mode = data.githubMode?.mode ?? null;
  const stored = data.github;
  const serverUrl = env.NEXT_PUBLIC_SERVER_URL || "https://your-api.example.com";

  const statusText =
    stored?.mode === "pat"
      ? `Shared PAT active for @${stored.accountLogin} (ending in ${stored.patSuffix}).`
      : stored?.mode === "app"
        ? `App connected: ${stored.slug} (ID ${stored.appId}).`
        : mode === "app"
          ? "Using the legacy env-configured GitHub App. Save an App here to move repository access into GitTerm."
          : "No repository credentials configured. Save either an App or a shared PAT, then enable GitHub for users.";

  async function saveApp() {
    if (
      mode &&
      !window.confirm(
        "Replace the current GitHub credentials? Switching modes stops refresh for existing workspaces using the previous mode.",
      )
    )
      return;
    try {
      await configureApp.mutateAsync({
        appId,
        privateKey,
        webhookSecret,
        replace: mode === "pat",
      });
      setPrivateKey("");
      setWebhookSecret("");
      await refresh();
      toast.success("GitHub App verified and saved");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn’t configure GitHub App");
    }
  }

  async function savePat() {
    if (
      mode &&
      !window.confirm(
        "Replace the current GitHub credentials? Switching modes stops refresh for existing workspaces using the previous mode. Revoke the old PAT on GitHub if needed.",
      )
    )
      return;
    try {
      await configurePat.mutateAsync({ token: pat, replace: mode === "app" });
      setPat("");
      await refresh();
      toast.success("Shared GitHub PAT verified and saved");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn’t configure GitHub PAT");
    }
  }

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground/90">Repository credentials</p>
            </div>
            <p className="text-xs text-muted-foreground">{statusText}</p>
          </div>
          <div className="flex items-center gap-2">
            <ActiveBadge active={mode === "app"} label="GitHub App" />
            <ActiveBadge active={mode === "pat"} label="Shared PAT" />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          icon={AppWindow}
          title="GitHub App"
          description="Each user installs the App on the repositories they want to use. Recommended for teams."
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gh-app-id">App ID</Label>
              <Input
                id="gh-app-id"
                inputMode="numeric"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="1234567"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gh-webhook">Webhook secret</Label>
              <Input
                id="gh-webhook"
                type="password"
                autoComplete="off"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="Same secret configured in GitHub"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gh-pem">Private key (PEM)</Label>
              <Textarea
                id="gh-pem"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="-----BEGIN RSA PRIVATE KEY-----"
                spellCheck={false}
                className="min-h-28 font-mono text-xs"
              />
            </div>
            <div className="rounded-xl border border-border bg-fill p-3 text-xs text-muted-foreground space-y-1.5">
              <p>
                Setup URL:{" "}
                <code className="break-all text-foreground/80">
                  {serverUrl}/api/github/callback
                </code>
              </p>
              <p>
                Webhook URL:{" "}
                <code className="break-all text-foreground/80">
                  /trpc/github.handleInstallationWebhook
                </code>
              </p>
              <p>Grant only the repository permissions your users need.</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] text-amber-400/80">
                The API and webhook listener must share the same encryption master key.
              </p>
              <Button
                disabled={configureApp.isPending || !appId || !privateKey || !webhookSecret}
                onClick={saveApp}
                className="font-mono text-xs font-bold uppercase tracking-wider"
              >
                {configureApp.isPending
                  ? "Verifying..."
                  : mode === "pat"
                    ? "Switch to App"
                    : stored?.mode === "app"
                      ? "Replace App"
                      : "Verify & Save"}
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          icon={KeyRound}
          title="Shared PAT"
          description="One fine-grained PAT shared with every workspace that selects it. Revoke it on GitHub to cut access."
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gh-pat">Fine-grained PAT</Label>
              <Input
                id="gh-pat"
                type="password"
                autoComplete="off"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder="github_pat_…"
                className="font-mono text-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The PAT’s GitHub identity and permissions apply to every workspace using it. Scope it
              narrowly.
            </p>
            <div className="flex justify-end">
              <Button
                disabled={!pat.trim() || configurePat.isPending}
                onClick={savePat}
                className="font-mono text-xs font-bold uppercase tracking-wider"
              >
                {configurePat.isPending
                  ? "Verifying..."
                  : mode === "app"
                    ? "Switch to PAT"
                    : stored?.mode === "pat"
                      ? "Replace PAT"
                      : "Verify & Save"}
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
