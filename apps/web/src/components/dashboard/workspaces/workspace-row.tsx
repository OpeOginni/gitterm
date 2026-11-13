"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import { useMutation } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AppWindow,
  Box,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Globe,
  Infinity as InfinityIcon,
  Loader2,
  Lock,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Server,
  Smartphone,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc, trpcClient } from "@/utils/trpc";
import {
  cn,
  getAttachCommand,
  getT3DesktopPairingUrl,
  getT3PairingUrl,
  getWorkspaceOpenPortUrl,
  getWorkspaceProjectPath,
  getWorkspaceUrl,
  isOpencodeAgent,
  isT3Agent,
  supportsPairingLinks,
} from "@/lib/utils";
import { track } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CopyField } from "@/components/dashboard/copy-field";
import { StatusDot } from "@/components/dashboard/kit";
import {
  formatHourlyPrice,
  formatMachineSize,
  getIcon,
} from "@/components/dashboard/create-instance/types";
import {
  opencodeSessionAttachCommand,
  openOpencodeInBrowser,
  startOpencodePairing,
} from "@/components/dashboard/opencode-connect";
import {
  EditorAccessDialog,
  OpencodeAppDialog,
  OpenPortDialog,
  TerminateDialog,
} from "./workspace-dialogs";
import {
  PROVIDER_LOGOS,
  STATUS,
  isSandbox,
  machineProfileOf,
  repoHref,
  repoName,
  type CloudProvider,
  type Workspace,
} from "./workspace-meta";

const invalidateWorkspaces = () =>
  queryClient.invalidateQueries({ queryKey: trpc.workspace.listWorkspaces.queryKey() });

const ago = (date: Date | string) => formatDistanceToNow(new Date(date), { addSuffix: true });

/** How long a sandbox has before it removes itself; sandboxes are created with a lifetime. */
type RowDialog = "editor" | "port" | "terminate" | "app";

const endsIn = (workspace: Workspace) => {
  if (!workspace.autoTerminateAt) return null;
  const minutes = Math.ceil((new Date(workspace.autoTerminateAt).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return "Ending now";
  return minutes < 60 ? `${minutes} min left` : `${Math.round(minutes / 60)} h left`;
};

export function WorkspaceRow({
  workspace,
  provider,
  snapshotLabel,
}: {
  workspace: Workspace;
  provider: CloudProvider | undefined;
  /** The snapshot an agent sandbox started from. */
  snapshotLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<RowDialog | null>(null);
  const [appPairing, setAppPairing] = useState<ReturnType<typeof startOpencodePairing> | null>(
    null,
  );

  const agent = workspace.image.agentType;
  const providerKey = provider?.providerKey ?? workspace.cloudProvider?.providerKey ?? undefined;
  const providerName = provider?.name ?? workspace.cloudProvider?.name ?? "Unknown";
  const sandbox = isSandbox(workspace);
  const isRunning = workspace.status === "running";
  const isPaused = workspace.status === "paused";
  const isPending = workspace.status === "pending";
  const status = STATUS[workspace.status] ?? { label: workspace.status, tone: "muted" as const };
  const workspaceUrl = workspace.subdomain ? getWorkspaceUrl(workspace.subdomain) : null;
  const repo = repoName(workspace.repositoryUrl);

  const isT3 = isT3Agent(agent.name, agent.provisionerKey);
  const isOpencode = isOpencodeAgent(agent.name, agent.provisionerKey);
  // OpenCode server pairing links need /auth/connect at the origin root, so subdomain routing.
  const canPairOpencode =
    agent.provisionerKey === "opencode" &&
    workspace.serverOnly &&
    workspace.hasAccessCredential &&
    supportsPairingLinks();

  const trackConnection = (method: "browser" | "desktop" | "cli" | "editor") =>
    track("workspace_connection_requested", {
      provider: providerKey ?? "unknown",
      agent: agent.provisionerKey,
      method,
    });

  const revealCredential = async () => {
    if (isT3 && !supportsPairingLinks()) {
      toast.error("T3 Code needs subdomain routing; path-based connections are not supported.");
      return null;
    }
    if (!workspace.hasAccessCredential) return null;
    try {
      const result = await trpcClient.workspace.getAccessCredential.mutate({
        workspaceId: workspace.id,
      });
      return result.credential;
    } catch {
      toast.error("Failed to retrieve the workspace credential");
      return null;
    }
  };

  const restart = useMutation(
    trpc.workspace.restartWorkspace.mutationOptions({
      onSuccess: (data) => {
        track("workspace_restarted", {
          provider: providerKey ?? "unknown",
          agent: agent.provisionerKey,
        });
        toast.success(data.status === "pending" ? "Workspace restarting…" : "Workspace restarted");
        void invalidateWorkspaces();
      },
      onError: (error) => toast.error(`Failed to restart workspace: ${error.message}`),
    }),
  );

  const attachTui = async () => {
    if (!workspace.subdomain) return;
    let command: string | undefined;
    if (canPairOpencode) {
      // A paired session token keeps the permanent password out of shells.
      // Older servers cannot pair; fall back to the password command.
      command = await opencodeSessionAttachCommand(workspace.id).catch(() => undefined);
    }
    command ??= getAttachCommand(workspace.subdomain, agent.name, await revealCredential());
    await navigator.clipboard.writeText(command);
    trackConnection("cli");
    toast.success("Attach command copied", {
      description: "Paste it into your terminal and press Enter to open the TUI.",
    });
  };

  const connectOpencodeApp = () => {
    trackConnection("desktop");
    setAppPairing(startOpencodePairing(workspace.id));
    setDialog("app");
  };

  const openT3App = async () => {
    const credential = await revealCredential();
    if (!credential || !workspace.subdomain) return;
    trackConnection("desktop");
    window.location.href = getT3DesktopPairingUrl(workspace.subdomain, credential);
  };

  const openT3InBrowser = async () => {
    // Open the tab during the click so pop-up blockers allow it, then send it to the pairing link.
    const tab = window.open("", "_blank");
    if (!tab) return void toast.error("Allow pop-ups to open T3 Code");
    tab.opener = null;
    const credential = await revealCredential();
    if (!credential || !workspace.subdomain) return tab.close();
    trackConnection("browser");
    tab.location.href = getT3PairingUrl(workspace.subdomain, credential);
  };

  let primary: ReactNode = null;
  if (isRunning && sandbox) {
    // No agent runs in a sandbox, so there is nothing to open or attach.
    primary = <span className="block text-right text-[12.5px] text-fg-3">{endsIn(workspace)}</span>;
  } else if (isRunning && workspaceUrl) {
    if (!workspace.serverOnly) {
      primary = (
        <Button size="sm" variant="secondary" className="w-full" asChild>
          <a
            href={workspaceUrl}
            target="_blank"
            rel="noreferrer"
            title="Open this workspace's terminal in a new tab"
            onClick={() => trackConnection("browser")}
          >
            <SquareTerminal className="size-3.5" />
            Open terminal
            <ExternalLink className="size-3 text-fg-4" />
          </a>
        </Button>
      );
    } else if (isT3) {
      primary = (
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          disabled={!workspace.hasAccessCredential}
          title="Open in the T3 Code desktop app with a one-time pairing link"
          onClick={() => void openT3App()}
        >
          <AppWindow className="size-3.5" />
          Open in T3
        </Button>
      );
    } else {
      primary = (
        <>
          <Button
            size="sm"
            variant="secondary"
            className="w-full max-sm:hidden"
            title="Copy a command that opens this workspace in your terminal"
            onClick={() => void attachTui()}
          >
            <Copy className="size-3.5" />
            Attach TUI
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="w-full sm:hidden"
            onClick={() => {
              trackConnection("browser");
              if (canPairOpencode) void openOpencodeInBrowser(workspace.id, workspaceUrl);
              else window.open(workspaceUrl, "_blank", "noreferrer");
            }}
          >
            <Globe className="size-3.5" />
            Open in browser
            <ExternalLink className="size-3 text-fg-4" />
          </Button>
        </>
      );
    }
  } else if (isPaused) {
    primary = (
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        disabled={restart.isPending}
        onClick={() => restart.mutate({ workspaceId: workspace.id })}
      >
        {restart.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Play className="size-3.5" />
        )}
        Restart
      </Button>
    );
  }

  const lastSeen = workspace.lastActiveAt ?? workspace.startedAt;

  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 sm:flex-nowrap sm:px-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-center gap-3.5 rounded-md text-left focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill">
            {sandbox ? (
              <Box className="size-4 text-fg-3" />
            ) : (
              <Image
                src={getIcon(agent.name)}
                alt=""
                width={18}
                height={18}
                className="size-[18px] object-contain"
              />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-medium text-fg transition-colors group-hover:text-fg-2">
                {workspace.name || workspace.subdomain}
              </span>
              {workspace.alwaysOn && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 text-[12px] text-primary"
                  title="Stays on when idle"
                >
                  <InfinityIcon className="size-3.5" />
                  <span className="max-sm:sr-only">Always on</span>
                </span>
              )}
            </span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px]">
              {repo && (
                <span className="min-w-0 truncate font-mono text-[12px] text-fg-3">
                  {repo}
                  {workspace.repositoryBranch && (
                    <span className="text-fg-4">:{workspace.repositoryBranch}</span>
                  )}
                </span>
              )}
              <span className="shrink-0 text-fg-4">
                {sandbox ? "Agent sandbox" : agent.name} on {providerName}
              </span>
              {snapshotLabel && (
                <span className="min-w-0 truncate text-fg-4">
                  from <span className="font-mono text-[12px] text-fg-3">{snapshotLabel}</span>
                </span>
              )}
            </span>
          </span>
        </button>

        <div className="flex w-full items-center gap-2 pl-[50px] sm:w-auto sm:shrink-0 sm:pl-0">
          <div className="mr-auto min-w-0 sm:mr-3 sm:w-[156px]">
            <StatusDot tone={status.tone} pulse={isPending}>
              {status.label}
            </StatusDot>
            <p className="mt-0.5 truncate text-[12px] text-fg-4 max-sm:hidden">
              {isPending ? `Started ${ago(workspace.startedAt)}` : `Active ${ago(lastSeen)}`}
            </p>
          </div>
          <div className="w-[148px]">{primary}</div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Hide details" : "Show details"}
            title={open ? "Hide details" : "Details"}
            className="size-8 px-0"
          >
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      </div>

      {open && (
        <WorkspaceDetails
          workspace={workspace}
          sandbox={sandbox}
          provider={provider}
          providerKey={providerKey}
          providerName={providerName}
          workspaceUrl={workspaceUrl}
          isT3={isT3}
          isOpencode={isOpencode}
          canPairOpencode={canPairOpencode}
          revealCredential={revealCredential}
          openT3InBrowser={openT3InBrowser}
          trackConnection={trackConnection}
          onDialog={setDialog}
          onConnectOpencodeApp={connectOpencodeApp}
        />
      )}

      {workspace.editorAccessEnabled && (
        <EditorAccessDialog
          workspace={workspace}
          open={dialog === "editor"}
          onOpenChange={(o) => setDialog(o ? "editor" : null)}
          onConnect={() => trackConnection("editor")}
        />
      )}
      <OpenPortDialog
        workspace={workspace}
        open={dialog === "port"}
        onOpenChange={(o) => setDialog(o ? "port" : null)}
      />
      <TerminateDialog
        workspace={workspace}
        open={dialog === "terminate"}
        onOpenChange={(o) => setDialog(o ? "terminate" : null)}
      />
      {canPairOpencode && (
        <OpencodeAppDialog
          workspaceId={workspace.id}
          started={appPairing}
          open={dialog === "app"}
          onOpenChange={(o) => setDialog(o ? "app" : null)}
        />
      )}
    </li>
  );
}

function WorkspaceDetails({
  workspace,
  sandbox,
  provider,
  providerKey,
  providerName,
  workspaceUrl,
  isT3,
  isOpencode,
  canPairOpencode,
  revealCredential,
  openT3InBrowser,
  trackConnection,
  onDialog,
  onConnectOpencodeApp,
}: {
  workspace: Workspace;
  sandbox: boolean;
  provider: CloudProvider | undefined;
  providerKey: string | undefined;
  providerName: string;
  workspaceUrl: string | null;
  isT3: boolean;
  isOpencode: boolean;
  canPairOpencode: boolean;
  revealCredential: () => Promise<string | null>;
  openT3InBrowser: () => Promise<void>;
  trackConnection: (method: "browser" | "desktop" | "cli" | "editor") => void;
  onDialog: (dialog: RowDialog) => void;
  onConnectOpencodeApp: () => void;
}) {
  const isRunning = workspace.status === "running";
  const canPause = isRunning || workspace.status === "pending";
  const region = provider?.regions?.find((r) => r.id === workspace.regionId);
  const profile = machineProfileOf(workspace, provider);
  const size = profile ? formatMachineSize(profile) : null;
  const repoUrl = repoHref(workspace);
  const ports = Object.entries(workspace.exposedPorts ?? {});

  const pause = useMutation(
    trpc.workspace.pauseWorkspace.mutationOptions({
      onSuccess: () => {
        toast.success("Workspace paused");
        void invalidateWorkspaces();
      },
      onError: (error) => toast.error(`Failed to pause workspace: ${error.message}`),
    }),
  );
  const setAlwaysOn = useMutation(
    trpc.workspace.setAlwaysOn.mutationOptions({
      onSuccess: (data) => {
        toast.success(
          data.alwaysOn
            ? "Workspace stays on when idle. Spending limits still apply."
            : "Workspace pauses when idle again",
        );
        void invalidateWorkspaces();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  // Running server-only workspaces open in a browser too; the row's main button is the TUI or app.
  let openInBrowser: ReactNode = null;
  if (isRunning && workspaceUrl && workspace.serverOnly && !sandbox) {
    openInBrowser = isT3 ? (
      <Button
        size="sm"
        variant="secondary"
        disabled={!workspace.hasAccessCredential}
        onClick={() => void openT3InBrowser()}
      >
        <Globe className="size-3.5" />
        Open in browser
        <ExternalLink className="size-3 text-fg-4" />
      </Button>
    ) : canPairOpencode ? (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          trackConnection("browser");
          void openOpencodeInBrowser(workspace.id, workspaceUrl);
        }}
      >
        <Globe className="size-3.5" />
        Open in browser
        <ExternalLink className="size-3 text-fg-4" />
      </Button>
    ) : (
      <Button size="sm" variant="secondary" asChild>
        <a
          href={workspaceUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => trackConnection("browser")}
        >
          <Globe className="size-3.5" />
          Open in browser
          <ExternalLink className="size-3 text-fg-4" />
        </a>
      </Button>
    );
  }

  const showAccess = isRunning && workspaceUrl;

  return (
    <div className="@container border-t border-line bg-card px-4 pt-4 pb-5 sm:px-5 sm:pl-[70px]">
      <div className="flex flex-wrap items-center gap-2">
        {openInBrowser}
        {canPairOpencode && isRunning && (
          <Button size="sm" variant="secondary" onClick={onConnectOpencodeApp}>
            <Smartphone className="size-3.5" />
            Connect OpenCode app
          </Button>
        )}
        {workspace.editorAccessEnabled && isRunning && (
          <Button size="sm" variant="secondary" onClick={() => onDialog("editor")}>
            <Monitor className="size-3.5" />
            Connect editor
          </Button>
        )}
        <div className="flex items-center gap-1 sm:ml-auto">
          {canPause && (
            <Button
              size="sm"
              variant="ghost"
              className="text-fg-2"
              disabled={pause.isPending}
              onClick={() => pause.mutate({ workspaceId: workspace.id })}
            >
              {pause.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Pause className="size-3.5" />
              )}
              Pause
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onDialog("terminate")}
          >
            <Trash2 className="size-3.5" />
            Terminate
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-x-10 gap-y-6 @2xl:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
        <div className="grid min-w-0 content-start gap-6">
          {sandbox ? (
            <DetailGroup title="Agent sandbox">
              <p className="max-w-prose text-[13px] leading-relaxed text-fg-3">
                Runs commands for your local agent or your code through the SDK. No agent runs
                inside.
              </p>
              <p className="text-[13px] text-fg-2">{endsIn(workspace) ?? "No time limit"}</p>
            </DetailGroup>
          ) : showAccess ? (
            <DetailGroup title="Connect">
              <CopyField label="URL" value={workspaceUrl} />
              {workspace.hasAccessCredential &&
                (isT3 ? (
                  <SecretCopy
                    label="Pairing link"
                    hint="Works once"
                    copiedMessage="Pairing link copied. It works once."
                    reveal={async () => {
                      const credential = await revealCredential();
                      return credential && workspace.subdomain
                        ? getT3PairingUrl(workspace.subdomain, credential)
                        : null;
                    }}
                    extra={<NewPairingLink workspaceId={workspace.id} />}
                  />
                ) : (
                  <SecretCopy
                    label="Server password"
                    hint="••••••••••••••••"
                    copiedMessage="Password copied"
                    reveal={revealCredential}
                  />
                ))}
              {isOpencode && (
                <CopyField
                  label="Project path"
                  value={getWorkspaceProjectPath(providerKey, workspace.repositoryUrl)}
                />
              )}
            </DetailGroup>
          ) : (
            <DetailGroup title="Connect">
              <p className="text-[13px] text-fg-3">
                {workspace.status === "pending"
                  ? "Connection details appear once it is running."
                  : "Restart it to connect."}
              </p>
            </DetailGroup>
          )}

          <DetailGroup title="Ports">
            {ports.length === 0 && <p className="text-[13px] text-fg-3">No open ports.</p>}
            {ports.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {ports.map(([port, exposed]) => (
                  <PortRow
                    key={port}
                    workspace={workspace}
                    port={parseInt(port, 10)}
                    name={exposed.name}
                    isPublic={exposed.visibility === "public"}
                  />
                ))}
              </ul>
            )}
            {isRunning && (
              <Button
                size="sm"
                variant="secondary"
                className="w-fit"
                onClick={() => onDialog("port")}
              >
                <Plus className="size-3.5" />
                Open port
              </Button>
            )}
          </DetailGroup>
        </div>

        <div className="max-w-sm min-w-0 @2xl:max-w-none @2xl:border-l @2xl:border-line @2xl:pl-10">
          <DetailGroup title="Machine">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
              <Fact label="Provider">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  {providerKey && PROVIDER_LOGOS[providerKey] ? (
                    <Image
                      src={PROVIDER_LOGOS[providerKey]}
                      alt=""
                      width={14}
                      height={14}
                      className="size-3.5 shrink-0 object-contain"
                    />
                  ) : (
                    <Server className="size-3.5 shrink-0 text-fg-4" />
                  )}
                  <span className="truncate">
                    {providerName}
                    {region && <span className="text-fg-3"> {region.name}</span>}
                  </span>
                </span>
              </Fact>
              {(size || profile) && (
                <Fact label="Size">
                  {size ?? profile?.name}
                  {profile?.priceMicrosPerHour != null && (
                    <span className="text-fg-3">
                      {" "}
                      {formatHourlyPrice(profile.priceMicrosPerHour)}
                    </span>
                  )}
                </Fact>
              )}
              <Fact label="Started">{ago(workspace.startedAt)}</Fact>
              {workspace.repositoryUrl && (
                <Fact label="Repository">
                  {repoUrl ? (
                    <a
                      href={repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-full items-center gap-1 font-mono text-[12.5px] text-fg-2 transition-colors hover:text-fg"
                    >
                      <span className="truncate">
                        {repoName(workspace.repositoryUrl)}
                        {workspace.repositoryBranch ? `:${workspace.repositoryBranch}` : ""}
                      </span>
                      <ExternalLink className="size-3 shrink-0 text-fg-4" />
                    </a>
                  ) : (
                    <span className="truncate font-mono text-[12.5px]">
                      {workspace.repositoryUrl}
                    </span>
                  )}
                </Fact>
              )}
            </dl>
            {workspace.hostingType === "cloud" && (
              <label className="mt-1 flex cursor-pointer items-center justify-between gap-4 text-[13px] text-fg-2">
                <span>
                  Keep on when idle
                  <span className="block text-[12px] text-fg-4">Spending limits still apply.</span>
                </span>
                <Switch
                  checked={workspace.alwaysOn}
                  disabled={setAlwaysOn.isPending}
                  onCheckedChange={(alwaysOn) =>
                    setAlwaysOn.mutate({ workspaceId: workspace.id, alwaysOn })
                  }
                />
              </label>
            )}
          </DetailGroup>
        </div>
      </div>
    </div>
  );
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 content-start gap-3">
      <h3 className="text-[13px] font-medium text-fg">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-4">{label}</dt>
      <dd className="min-w-0 truncate text-fg-2">{children}</dd>
    </>
  );
}

/**
 * Like CopyField, for a value fetched only when copied (a password or one-time link).
 * `reveal` returns the text to copy, or null when it handled the copy itself or failed.
 */
function SecretCopy({
  label,
  hint,
  copiedMessage,
  reveal,
  extra,
}: {
  label: string;
  hint: string;
  copiedMessage?: string;
  reveal: () => Promise<string | null>;
  extra?: ReactNode;
}) {
  const [state, setState] = useState<"idle" | "busy" | "copied">("idle");
  const copy = async () => {
    setState("busy");
    const value = await reveal();
    if (value) {
      await navigator.clipboard.writeText(value);
      if (copiedMessage) toast.success(copiedMessage);
      setState("copied");
      setTimeout(() => setState("idle"), 1600);
    } else {
      setState("idle");
    }
  };
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-fg-2">{label}</p>
        {extra}
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        disabled={state === "busy"}
        aria-label={`Copy ${label.toLowerCase()}`}
        className="group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg bg-fill-2 py-2 pr-2.5 pl-3 text-left transition-colors hover:bg-line-2 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] leading-relaxed text-fg-4">
          {hint}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center justify-end gap-1.5 text-[12.5px] font-medium transition-colors sm:w-[4.25rem]",
            state === "copied" ? "text-primary" : "text-fg-3 group-hover:text-fg",
          )}
        >
          {state === "busy" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : state === "copied" ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          <span className="max-sm:sr-only">{state === "copied" ? "Copied" : "Copy"}</span>
        </span>
      </button>
    </div>
  );
}

/** T3 pairing links work once; this issues a fresh one for another device. */
function NewPairingLink({ workspaceId }: { workspaceId: string }) {
  const regenerate = useMutation(
    trpc.workspace.regenerateAccessCredential.mutationOptions({
      onSuccess: () => {
        toast.success("New pairing link ready");
        void invalidateWorkspaces();
      },
      onError: (error) => toast.error(`Failed to generate pairing link: ${error.message}`),
    }),
  );
  return (
    <button
      type="button"
      disabled={regenerate.isPending}
      onClick={() => regenerate.mutate({ workspaceId })}
      className="inline-flex items-center gap-1 text-[12.5px] text-fg-3 transition-colors hover:text-fg disabled:opacity-60"
    >
      {regenerate.isPending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <RefreshCw className="size-3" />
      )}
      New link
    </button>
  );
}

function PortRow({
  workspace,
  port,
  name,
  isPublic,
}: {
  workspace: Workspace;
  port: number;
  name?: string | null;
  isPublic: boolean;
}) {
  const url = workspace.subdomain ? getWorkspaceOpenPortUrl(workspace.subdomain, port) : null;
  const setVisibility = useMutation(
    trpc.workspace.setWorkspacePortVisibility.mutationOptions({
      onSuccess: (data) => {
        toast.success(
          data.visibility === "public"
            ? `Port ${data.port} is now public`
            : `Port ${data.port} is now private`,
        );
        void invalidateWorkspaces();
      },
      onError: (error) => toast.error(`Failed to update port: ${error.message}`),
    }),
  );
  const close = useMutation(
    trpc.workspace.closeWorkspacePort.mutationOptions({
      onSuccess: () => {
        toast.success("Port closed");
        void invalidateWorkspaces();
      },
      onError: (error) => toast.error(`Failed to close port: ${error.message}`),
    }),
  );

  return (
    <li className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-line py-0.5 pr-0.5 pl-2 text-[13px]">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open :${port} in a new tab`}
          className="-ml-1.5 inline-flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-fill-2"
        >
          <span className="font-mono text-[12.5px] text-fg">:{port}</span>
          <span className="truncate text-fg-3">{name || "Port"}</span>
          <ExternalLink className="size-3 shrink-0 text-fg-4" />
        </a>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="font-mono text-[12.5px] text-fg">:{port}</span>
          <span className="truncate text-fg-3">{name || "Port"}</span>
        </span>
      )}
      <button
        type="button"
        onClick={() =>
          setVisibility.mutate({
            workspaceId: workspace.id,
            port,
            visibility: isPublic ? "private" : "public",
          })
        }
        disabled={setVisibility.isPending}
        title={
          isPublic
            ? "Anyone with the URL can reach this port. Click to make it private."
            : "Only your signed-in browser can reach this port. Click to make it public."
        }
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-fill-2 px-2 py-0.5 text-[12px] text-fg-2 transition-colors hover:bg-line-2 hover:text-fg disabled:opacity-70"
      >
        {setVisibility.isPending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : isPublic ? (
          <Globe className="size-3" />
        ) : (
          <Lock className="size-3" />
        )}
        {isPublic ? "Public" : "Private"}
      </button>
      <button
        type="button"
        onClick={() => close.mutate({ workspaceId: workspace.id, port })}
        disabled={close.isPending}
        title="Close port"
        aria-label={`Close port ${port}`}
        className="shrink-0 rounded-md p-1.5 text-fg-4 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-70"
      >
        {close.isPending ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
      </button>
    </li>
  );
}
