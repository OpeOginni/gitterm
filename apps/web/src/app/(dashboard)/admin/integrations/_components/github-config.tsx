"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import Image from "next/image";
import { toast } from "sonner";
import { apiPath } from "@gitterm/schema/url";
import { CopyField } from "@/components/dashboard/copy-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/utils/trpc";
import env from "@gitterm/env/web";
import type { AdminIntegrationsData } from "./use-admin-integrations";
import { SettingsGroup, settingsLabel } from "@/components/dashboard/settings/settings-page";
import { StatusChip } from "./ui";

type Props = {
  data: AdminIntegrationsData;
  refresh: () => Promise<void>;
};

function GithubAccountLink({ login, size = "sm" }: { login: string; size?: "sm" | "md" }) {
  const safeLogin = encodeURIComponent(login);
  return (
    <a
      href={`https://github.com/${safeLogin}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-2 rounded-full bg-fill-2 py-1 pr-3 pl-1 text-fg-2 transition-colors hover:text-fg"
    >
      <Image
        src={`https://github.com/${safeLogin}.png`}
        alt=""
        width={size === "md" ? 32 : 24}
        height={size === "md" ? 32 : 24}
        className={
          size === "md" ? "size-8 rounded-full object-cover" : "size-6 rounded-full object-cover"
        }
      />
      <span className="truncate text-[13px] font-medium">@{login}</span>
    </a>
  );
}

function ActiveBadge({ active, label }: { active: boolean; label: string }) {
  return <StatusChip tone={active ? "ok" : "muted"} label={label} />;
}

export function GithubConfig({ data, refresh }: Props) {
  const [appId, setAppId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [pat, setPat] = useState("");
  const keyFile = useRef<HTMLInputElement>(null);

  const configureApp = useMutation(trpc.admin.integrations.configureGithubApp.mutationOptions());
  const configurePat = useMutation(trpc.admin.integrations.configureGithubPat.mutationOptions());

  const mode = data.githubMode?.mode ?? null;
  const stored = data.github;
  const callbackUrl = apiPath(
    env.NEXT_PUBLIC_SERVER_URL || "https://your-api.example.com",
    "github/callback",
  );
  // The webhook router lives on the listener, not the API server.
  const listenerUrl = (env.NEXT_PUBLIC_LISTENER_URL || "https://your-listener.example.com").replace(
    /\/+$/,
    "",
  );
  const webhookUrl = `${listenerUrl}/trpc/github.handleInstallationWebhook`;
  const patLogin = stored?.mode === "pat" && stored.accountLogin ? stored.accountLogin : null;

  const statusText =
    stored?.mode === "pat"
      ? `Shared PAT active for @${stored.accountLogin} (ending in ${stored.patSuffix}).`
      : stored?.mode === "app"
        ? `App connected: ${stored.slug} (ID ${stored.appId}).`
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
      <SettingsGroup
        title="Repository credentials"
        description={
          <span className="flex flex-wrap items-center gap-2">
            {statusText}
            {patLogin ? <GithubAccountLink login={patLogin} /> : null}
          </span>
        }
        action={
          <>
            <ActiveBadge active={mode === "app"} label="GitHub App" />
            <ActiveBadge active={mode === "pat"} label="Shared PAT" />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <SettingsGroup
          title="GitHub App"
          description="Each user installs the App on the repositories they want to use. Recommended for teams."
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gh-app-id" className={settingsLabel}>
                App ID
              </Label>
              <Input
                id="gh-app-id"
                inputMode="numeric"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="1234567"
                className="font-mono text-[13px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gh-webhook" className={settingsLabel}>
                Webhook secret
              </Label>
              <Input
                id="gh-webhook"
                type="password"
                autoComplete="off"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="Same secret configured in GitHub"
                className="font-mono text-[13px]"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="gh-pem" className={settingsLabel}>
                  Private key
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => keyFile.current?.click()}
                >
                  Choose .pem file
                </Button>
                <input
                  ref={keyFile}
                  type="file"
                  accept=".pem,.key,text/plain"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) setPrivateKey(await file.text());
                    e.target.value = "";
                  }}
                />
              </div>
              <Textarea
                id="gh-pem"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="Paste the .pem file's contents, or choose the file"
                spellCheck={false}
                className="min-h-28 font-mono text-[13px]"
              />
            </div>
            <CopyField label="Setup URL" value={callbackUrl} />
            <CopyField label="Webhook URL" value={webhookUrl} />
            <p className="text-[13px] text-fg-3">
              Grant only the repository permissions your users need.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-[#fb923c]">
                The API and webhook listener must share the same encryption master key.
              </p>
              <Button
                disabled={configureApp.isPending || !appId || !privateKey || !webhookSecret}
                onClick={saveApp}
              >
                {configureApp.isPending
                  ? "Verifying..."
                  : mode === "pat"
                    ? "Switch to App"
                    : stored?.mode === "app"
                      ? "Replace App"
                      : "Verify and save"}
              </Button>
            </div>
          </div>
        </SettingsGroup>

        <SettingsGroup
          title="Shared PAT"
          description="One fine-grained PAT shared with every workspace that selects it. Revoke it on GitHub to cut access."
        >
          <div className="space-y-4">
            {patLogin ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-fill p-3">
                <GithubAccountLink login={patLogin} size="md" />
                <p className="text-[13px] text-fg-3">Ending in {stored?.patSuffix}</p>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="gh-pat" className={settingsLabel}>
                Fine-grained PAT
              </Label>
              <Input
                id="gh-pat"
                type="password"
                autoComplete="off"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder="github_pat_…"
                className="font-mono text-[13px]"
              />
            </div>
            <p className="text-[13px] text-fg-3">
              The PAT’s GitHub identity and permissions apply to every workspace using it. Scope it
              narrowly.
            </p>
            <div className="flex justify-end">
              <Button disabled={!pat.trim() || configurePat.isPending} onClick={savePat}>
                {configurePat.isPending
                  ? "Verifying..."
                  : mode === "app"
                    ? "Switch to PAT"
                    : stored?.mode === "pat"
                      ? "Replace PAT"
                      : "Verify and save"}
              </Button>
            </div>
          </div>
        </SettingsGroup>
      </div>
    </>
  );
}
