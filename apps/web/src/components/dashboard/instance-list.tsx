"use client";

import { trpc, trpcClient, queryClient } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  ExternalLink,
  Trash2,
  PlayCircle,
  GitBranch,
  Clock,
  Globe,
  MapPin,
  Copy,
  Terminal,
  HeartPlusIcon,
  PauseIcon,
  Monitor,
  Server,
  ChevronLeft,
  ChevronRight,
  EthernetPort,
  Folder,
  X,
  Plus,
  KeyRound,
  SquareArrowOutUpRight,
  Lock,
  Link2,
  Infinity as InfinityIcon,
} from "lucide-react";
import Image from "next/image";
import { CopyField } from "@/components/dashboard/copy-field";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  getWorkspaceUrl,
  getAttachCommand,
  getWorkspaceDisplayUrl,
  getWorkspaceOpenPortUrl,
  getWorkspaceProjectPath,
  getT3PairingUrl,
  getT3DesktopPairingUrl,
  isT3Agent,
  isOpencodeAgent,
  supportsPairingLinks,
} from "@/lib/utils";
import { getIcon } from "@/components/dashboard/create-instance/types";
import { track } from "@/lib/analytics";
import {
  copyOpencodePairingLink,
  opencodeSessionAttachCommand,
  openOpencodeInBrowser,
} from "./opencode-connect";

const PROVIDER_LOGOS: Record<string, string> = {
  aws: "/aws.svg",
  cloudflare: "/cloudflare.svg",
  daytona: "/daytona.svg",
  e2b: "/E2B.svg",
  boat: "/boat.svg",
  exedev: "/exe.png",
  railway: "/railway.svg",
  vercel: "/vercel.svg",
  gitterm: "/gitterm.svg",
};
import Link from "next/link";

const ITEMS_PER_PAGE = 6;

const EMPTY_OPEN_PORT_FORM = { name: "", port: "", isPublic: false };

export function InstanceList() {
  const [page, setPage] = useState(0);

  const workspacesQuery = useQuery(
    trpc.workspace.listWorkspaces.queryOptions({
      limit: ITEMS_PER_PAGE,
      offset: page * ITEMS_PER_PAGE,
      status: "active",
    }),
  );

  const providersQuery = useQuery(trpc.workspace.listCloudProviders.queryOptions());

  const isLoading = workspacesQuery.isLoading || providersQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-fg-4" />
          <p className="text-sm text-fg-3">Loading workspaces…</p>
        </div>
      </div>
    );
  }

  const workspaces = workspacesQuery.data?.workspaces || [];
  const pagination = workspacesQuery.data?.pagination;
  const providers = providersQuery.data?.cloudProviders || [];
  const totalPages = pagination ? Math.ceil(pagination.total / ITEMS_PER_PAGE) : 0;

  if (workspaces.length === 0 && page === 0) {
    return (
      <div className="flex h-72 flex-col items-center justify-center rounded-2xl bg-card p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-fill-2">
          <Terminal className="size-5 text-fg-3" />
        </div>
        <h3 className="mt-5 text-[17px] font-semibold tracking-[-0.01em] text-fg">
          No workspaces yet
        </h3>
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-fg-3">
          Create one with the button above. Pick a GitHub repo to clone, commit and open pull
          requests, or start from a blank terminal.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(320px,420px))]">
        {workspaces.map((workspace) => (
          <InstanceCard key={workspace.id} workspace={workspace} providers={providers} />
        ))}
      </div>

      {/* Pagination */}
      {pagination && totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <p className="text-[13px] text-fg-3">
            Showing {pagination.offset + 1} to{" "}
            {Math.min(pagination.offset + workspaces.length, pagination.total)} of{" "}
            {pagination.total} workspaces
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0 || workspacesQuery.isFetching}
            >
              <ChevronLeft className="size-4 mr-1" />
              Previous
            </Button>
            <span className="px-2 text-[13px] text-fg-3">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!pagination.hasMore || workspacesQuery.isFetching}
            >
              Next
              <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type Workspace = NonNullable<
  (typeof trpc.workspace.listWorkspaces)["~types"]["output"]
>["workspaces"][number];
type CloudProvider =
  (typeof trpc.workspace.listCloudProviders)["~types"]["output"]["cloudProviders"][number];
type WorkspaceSSHAccess =
  (typeof trpc.workspace.getWorkspaceSSHAccess)["~types"]["output"]["access"];

export function InstanceCard({
  workspace,
  providers,
}: {
  workspace: Workspace;
  providers: CloudProvider[];
}) {
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [showOpenPortDialog, setShowOpenPortDialog] = useState(false);
  const [openPortForm, setOpenPortForm] = useState(EMPTY_OPEN_PORT_FORM);
  const [closingPort, setClosingPort] = useState<number | null>(null);

  const deleteServiceMutation = useMutation(
    trpc.workspace.deleteWorkspace.mutationOptions({
      onSuccess: (data) => {
        toast.success(
          data.cleanupInBackground
            ? "Workspace removed. Cloud cleanup is continuing in the background."
            : "Workspace terminated successfully",
        );
        queryClient.invalidateQueries({
          queryKey: trpc.workspace.listWorkspaces.queryKey(),
        });
      },
      onError: (error) => {
        toast.error(`Failed to terminate workspace: ${error.message}`);
      },
    }),
  );

  const pauseWorkspaceMutation = useMutation(
    trpc.workspace.pauseWorkspace.mutationOptions({
      onSuccess: () => {
        toast.success("Workspace paused successfully");
        queryClient.invalidateQueries({
          queryKey: trpc.workspace.listWorkspaces.queryKey(),
        });
      },
      onError: (error) => {
        toast.error(`Failed to pause workspace: ${error.message}`);
      },
    }),
  );

  const setAlwaysOnMutation = useMutation(
    trpc.workspace.setAlwaysOn.mutationOptions({
      onSuccess: (data) => {
        toast.success(
          data.alwaysOn
            ? "Workspace stays on when idle. Spending limits still apply."
            : "Workspace pauses when idle again",
        );
        queryClient.invalidateQueries({
          queryKey: trpc.workspace.listWorkspaces.queryKey(),
        });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const restartWorkspaceMutation = useMutation(
    trpc.workspace.restartWorkspace.mutationOptions({
      onSuccess: (data) => {
        track("workspace_restarted", {
          provider:
            providers.find((provider) => provider.id === workspace.cloudProviderId)?.providerKey ??
            "unknown",
          agent: workspace.image.agentType.provisionerKey,
        });
        toast.success(
          data.status === "pending"
            ? "Workspace restarting..."
            : "Workspace restarted successfully",
        );
        queryClient.invalidateQueries({
          queryKey: trpc.workspace.listWorkspaces.queryKey(),
        });
      },
      onError: (error) => {
        toast.error(`Failed to restart workspace: ${error.message}`);
      },
    }),
  );

  const regenerateAccessCredentialMutation = useMutation(
    trpc.workspace.regenerateAccessCredential.mutationOptions({
      onSuccess: () => {
        toast.success("New pairing link generated");
        queryClient.invalidateQueries({
          queryKey: trpc.workspace.listWorkspaces.queryKey(),
        });
      },
      onError: (error) => {
        toast.error(`Failed to generate pairing link: ${error.message}`);
      },
    }),
  );

  const openWorkspacePortMutation = useMutation(
    trpc.workspace.openWorkspacePort.mutationOptions({
      onSuccess: () => {
        toast.success("Port opened successfully");
        queryClient.invalidateQueries({
          queryKey: trpc.workspace.listWorkspaces.queryKey(),
        });
        setShowOpenPortDialog(false);
        setOpenPortForm(EMPTY_OPEN_PORT_FORM);
      },
      onError: (error) => {
        toast.error(`Failed to open port: ${error.message}`);
      },
    }),
  );

  const setPortVisibilityMutation = useMutation(
    trpc.workspace.setWorkspacePortVisibility.mutationOptions({
      onSuccess: (data) => {
        toast.success(
          data.visibility === "public"
            ? `Port ${data.port} is now public`
            : `Port ${data.port} is now private`,
        );
        queryClient.invalidateQueries({
          queryKey: trpc.workspace.listWorkspaces.queryKey(),
        });
      },
      onError: (error) => {
        toast.error(`Failed to update port: ${error.message}`);
      },
    }),
  );

  const closeWorkspacePortMutation = useMutation(
    trpc.workspace.closeWorkspacePort.mutationOptions({
      onSuccess: () => {
        toast.success("Port closed");
        queryClient.invalidateQueries({
          queryKey: trpc.workspace.listWorkspaces.queryKey(),
        });
      },
      onError: (error) => {
        toast.error(`Failed to close port: ${error.message}`);
      },
      onSettled: () => setClosingPort(null),
    }),
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#6bd586]/10 px-2 py-0.5 text-[12.5px] font-medium text-[#6bd586]">
            <span className="size-1.5 rounded-full bg-[#6bd586] motion-safe:animate-pulse" />
            Running
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-fill-2 px-2 py-0.5 text-[12.5px] font-medium text-fg-3">
            <Loader2 className="size-3 animate-spin" />
            Pending
          </span>
        );
      case "paused":
        return (
          <span className="inline-flex items-center rounded-md bg-fill-2 px-2 py-0.5 text-[12.5px] font-medium text-fg-3">
            Paused
          </span>
        );
      case "terminated":
        return (
          <span className="inline-flex items-center rounded-md bg-red-500/10 px-2 py-0.5 text-[12.5px] font-medium text-red-300">
            Terminated
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center rounded-md bg-fill-2 px-2 py-0.5 text-[12.5px] font-medium text-fg-3">
            {status}
          </span>
        );
    }
  };

  const getRepoName = () => {
    if (!workspace.repositoryUrl) return null;
    const name = workspace.repositoryUrl
      .replace("https://github.com/", "")
      .replace("https://gitlab.com/", "")
      .replace(".git", "");
    const branch = workspace.repositoryBranch;
    return branch ? `${name}:${branch}` : name;
  };

  const getRepoHref = () => {
    if (!workspace.repositoryUrl) return null;
    const base = workspace.repositoryUrl.replace(/\.git$/i, "");
    if (!/^https?:\/\//i.test(base)) return null;
    const branch = workspace.repositoryBranch;
    return branch ? `${base}/tree/${encodeURIComponent(branch)}` : base;
  };

  const getRegionInfo = () => {
    const provider = providers.find((p) => p.id === workspace.cloudProviderId);
    // Sandbox providers often have no per-instance region; omit the row then.
    const region = provider?.regions?.find((r: any) => r.id === workspace.regionId);
    return {
      name: region?.name,
      location: region?.location,
      providerName: provider?.name || "Unknown",
      providerKey: provider?.providerKey,
    };
  };

  const regionInfo = getRegionInfo();
  const trackConnection = (method: "browser" | "desktop" | "cli" | "editor") => {
    track("workspace_connection_requested", {
      provider: regionInfo.providerKey ?? "unknown",
      agent: workspace.image.agentType.provisionerKey,
      method,
    });
  };
  const isRunning = workspace.status === "running";
  const isPaused = workspace.status === "paused";
  const isPending = workspace.status === "pending";

  const editorAccessQuery = useQuery({
    ...trpc.workspace.getWorkspaceSSHAccess.queryOptions({
      workspaceId: workspace.id,
    }),
    enabled: showConnectDialog && workspace.editorAccessEnabled && isRunning,
    retry: false,
  });
  // Get the workspace URL for linking
  const workspaceUrl = workspace.subdomain ? getWorkspaceUrl(workspace.subdomain) : null;
  const workspaceDisplayUrl = workspace.subdomain
    ? getWorkspaceDisplayUrl(workspace.subdomain)
    : null;

  // T3 workspaces authenticate with one-time pairing links instead of a
  // server password; the stored credential is the current pairing token.
  const isT3 = isT3Agent(workspace.image.agentType.name, workspace.image.agentType.provisionerKey);
  const isOpencode = isOpencodeAgent(
    workspace.image.agentType.name,
    workspace.image.agentType.provisionerKey,
  );
  // OpenCode server pairing links need /auth/connect at the origin root, so subdomain routing.
  const canPairOpencode =
    workspace.image.agentType.provisionerKey === "opencode" &&
    workspace.serverOnly &&
    workspace.hasAccessCredential &&
    supportsPairingLinks();
  const projectPath = getWorkspaceProjectPath(regionInfo.providerKey, workspace.repositoryUrl);
  const agentIcon = getIcon(workspace.image.agentType.name);
  const portUrl = (port: number) =>
    workspace.subdomain ? getWorkspaceOpenPortUrl(workspace.subdomain, port) : null;

  const copyValue = async (value: string, successMessage: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  };

  const revealAccessCredential = async () => {
    if (isT3 && !supportsPairingLinks()) {
      toast.error("T3Code requires subdomain routing; path-based connections are not supported.");
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

  const editorProtocols = [
    { name: "VS Code", protocol: "vscode", icon: "/vscode.svg" },
    { name: "Cursor", protocol: "cursor", icon: "/cursor.svg" },
    { name: "Zed", protocol: "zed", icon: "/zed.svg" },
  ];

  const buildEditorUri = (protocol: string, remoteTarget: string, projectPathHint: string) => {
    if (protocol === "zed") {
      return `zed://ssh/${remoteTarget}${projectPathHint}`;
    }

    const authority = `ssh-remote+${remoteTarget}`;
    return `${protocol}://vscode-remote/${authority}${projectPathHint}`;
  };

  const renderEditorAccess = (access: WorkspaceSSHAccess) => {
    const needsProxySetup = access.transportKind === "proxycommand-ssh";
    const needsSshConfig = needsProxySetup || access.port !== 22;
    const remoteTarget = needsSshConfig
      ? access.hostAlias
      : `${access.user}@${access.host}:${access.port}`;
    const setupSteps = needsProxySetup
      ? [
          {
            label: "Install websocat",
            help: "Required locally so OpenSSH can tunnel through E2B.",
            value: "brew install websocat",
          },
          {
            label: "Add this to ~/.ssh/config",
            help: "Paste the snippet into the SSH config file on your machine.",
            value: access.sshConfigSnippet,
          },
        ]
      : [];

    return (
      <div className="grid gap-4">
        {!needsSshConfig && (
          <div className="grid gap-2">
            <p className="text-[13px] font-medium text-fg-2">SSH command</p>
            <CopyField value={access.sshCommand} />
          </div>
        )}

        {!needsProxySetup && needsSshConfig && (
          <div className="grid gap-2">
            <div>
              <p className="text-[13px] font-medium text-fg-2">One-time SSH config</p>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-3">
                Railway uses a TCP proxy on port {access.port}. Add this to{" "}
                <code>~/.ssh/config</code>, then use the editor buttons below.
              </p>
            </div>
            <CopyField multiline value={access.sshConfigSnippet} />
          </div>
        )}

        {needsProxySetup && (
          <div className="grid gap-2">
            <div>
              <p className="text-[13px] font-medium text-fg-2">One-time local setup</p>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-3">
                E2B needs a local proxy. Do these once, then use the editor buttons below.
              </p>
            </div>
            {setupSteps.map((step, index) => (
              <div key={step.label} className="grid gap-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[12px] font-semibold text-[#e2c47c]">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">{step.label}</p>
                    <p className="text-[13px] text-fg-3">{step.help}</p>
                  </div>
                </div>
                <CopyField multiline={step.value.includes("\n")} value={step.value} />
              </div>
            ))}
          </div>
        )}

        {/* Open in editor buttons */}
        <div className="grid gap-2">
          <p className="text-[13px] font-medium text-fg-2">Open in editor</p>
          <div className="grid gap-1.5">
            {editorProtocols.map((editor) => (
              <a
                key={editor.protocol}
                href={buildEditorUri(editor.protocol, remoteTarget, access.projectPathHint)}
                onClick={() => trackConnection("editor")}
                className="flex items-center gap-3 rounded-xl bg-fill px-3 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-fill-2"
              >
                <Image
                  src={editor.icon}
                  alt={editor.name}
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px]"
                />
                <span className="flex-1">Open in {editor.name}</span>
                <SquareArrowOutUpRight className="size-3.5 text-fg-4" />
              </a>
            ))}
          </div>
        </div>

        {needsSshConfig && (
          <details className="group text-[13px] text-fg-3">
            <summary className="cursor-pointer list-none font-medium text-fg-3 transition-colors hover:text-fg">
              Manual SSH command
            </summary>
            <CopyField value={access.sshCommand} className="mt-2" />
          </details>
        )}

        {/* Copy connection string for Neovim / other editors */}
        <div className="grid gap-2">
          <p className="text-[13px] font-medium text-fg-2">
            SSH target for Neovim and other editors
          </p>
          <CopyField value={access.sshConnectionString} />
        </div>

        <p className="text-[13px] text-fg-3">
          Project path: <code className="font-mono text-fg-2">{access.projectPathHint}</code>
          {access.expiresAt && (
            <span className="ml-2">
              &middot; Expires{" "}
              {formatDistanceToNow(new Date(access.expiresAt), {
                addSuffix: true,
              })}
            </span>
          )}
        </p>

        {access.notes.length > 0 && (
          <div className="grid gap-1.5 rounded-xl bg-fill px-3 py-2.5 text-[13px] leading-relaxed text-fg-3">
            {access.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect an editor</DialogTitle>
            <DialogDescription>Connect from your preferred editor over SSH.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            {editorAccessQuery.isLoading ? (
              <div className="flex items-center gap-2 rounded-xl bg-fill p-4 text-sm text-fg-3">
                <Loader2 className="size-4 animate-spin" />
                Preparing SSH access…
              </div>
            ) : editorAccessQuery.error ? (
              <div className="rounded-xl bg-[#fb923c]/10 p-4 text-sm text-[#fb923c]">
                {editorAccessQuery.error.message}
              </div>
            ) : editorAccessQuery.data ? (
              renderEditorAccess(editorAccessQuery.data.access)
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showOpenPortDialog}
        onOpenChange={(open) => {
          setShowOpenPortDialog(open);
          if (!open) setOpenPortForm(EMPTY_OPEN_PORT_FORM);
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Open workspace port</DialogTitle>
            <DialogDescription>Expose a port from this workspace.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const p = parseInt(openPortForm.port, 10);
              if (isNaN(p) || p < 1 || p > 65535) {
                toast.error("Port must be between 1 and 65535");
                return;
              }
              openWorkspacePortMutation.mutate({
                workspaceId: workspace.id,
                port: p,
                name: openPortForm.name.trim() || undefined,
                visibility: openPortForm.isPublic ? "public" : "private",
              });
            }}
          >
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="port-name">Name</Label>
                <Input
                  id="port-name"
                  value={openPortForm.name}
                  onChange={(e) => setOpenPortForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Opencode, API"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="port-num">Port</Label>
                <Input
                  id="port-num"
                  type="number"
                  min={1}
                  max={65535}
                  value={openPortForm.port}
                  onChange={(e) => setOpenPortForm((f) => ({ ...f, port: e.target.value }))}
                  placeholder="e.g. 7681"
                />
              </div>
              <div className="flex items-start justify-between gap-4 rounded-xl bg-fill px-3.5 py-3">
                <div className="grid gap-1">
                  <Label htmlFor="port-public">Public URL</Label>
                  <p className="text-[13px] leading-relaxed text-fg-3">
                    {openPortForm.isPublic
                      ? "Anyone with the URL can reach this port. Use this for APIs and webhooks."
                      : "Only you can reach this port, from a browser signed in to Gitterm."}
                  </p>
                </div>
                <Switch
                  id="port-public"
                  checked={openPortForm.isPublic}
                  onCheckedChange={(checked) =>
                    setOpenPortForm((f) => ({ ...f, isPublic: checked }))
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowOpenPortDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={openWorkspacePortMutation.isPending}>
                {openWorkspacePortMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Open port"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition-colors hover:border-line-2">
        <div className="px-5 pt-5 pb-3">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-fill-2">
                  <Image
                    src={agentIcon}
                    alt={workspace.image.agentType.name}
                    width={20}
                    height={20}
                    className="h-5 w-5 object-contain"
                  />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">
                    {workspace.name || workspace.subdomain}
                  </span>
                  <span className="truncate text-[13px] text-fg-3">
                    {workspace.image.agentType.name}
                  </span>
                </div>
              </div>
              {getStatusBadge(workspace.status)}
            </div>
            {getRepoName() &&
              (getRepoHref() ? (
                <a
                  href={getRepoHref() as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title={`Open ${workspace.repositoryUrl} on GitHub`}
                  className="flex min-w-0 items-center gap-2 pl-12 text-[13px] text-fg-3 transition-colors hover:text-fg"
                >
                  <GitBranch className="size-3.5 shrink-0" />
                  <span className="truncate font-mono text-[12.5px] underline decoration-line-2 underline-offset-2">
                    {getRepoName()}
                  </span>
                </a>
              ) : (
                <div className="flex min-w-0 items-center gap-2 pl-12 text-[13px] text-fg-3">
                  <GitBranch className="size-3.5 shrink-0" />
                  <span
                    className="truncate font-mono text-[12.5px]"
                    title={workspace.repositoryUrl || ""}
                  >
                    {getRepoName()}
                  </span>
                </div>
              ))}
          </div>
        </div>
        <div className="pb-4 px-5 flex-1">
          <div className="grid gap-2 pl-12 text-[13px] text-fg-3">
            {regionInfo.name && (
              <div className="flex items-center gap-2">
                <MapPin className="size-3.5 shrink-0" />
                <span className="truncate">
                  {regionInfo.location
                    ? `${regionInfo.name} · ${regionInfo.location}`
                    : regionInfo.name}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              {regionInfo.providerKey && PROVIDER_LOGOS[regionInfo.providerKey] ? (
                <Image
                  src={PROVIDER_LOGOS[regionInfo.providerKey]}
                  alt=""
                  width={14}
                  height={14}
                  className="size-3.5 shrink-0 object-contain"
                />
              ) : (
                <Server className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{regionInfo.providerName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="size-3.5 shrink-0" />
              <span className="truncate">
                {formatDistanceToNow(new Date(workspace.startedAt), {
                  addSuffix: true,
                })}
              </span>
            </div>
            {workspace.lastActiveAt && isRunning && (
              <div className="flex items-center gap-2">
                <HeartPlusIcon className="size-3.5 shrink-0 text-primary" />
                <span className="truncate text-[#e2c47c]">
                  Active{" "}
                  {formatDistanceToNow(new Date(workspace.lastActiveAt), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            )}
            {workspace.domain && isRunning && (
              <div className="flex items-center gap-2 mt-0.5 min-w-0">
                <Globe className="size-3.5 shrink-0 text-primary" />
                <button
                  onClick={() => {
                    if (workspaceUrl) {
                      navigator.clipboard.writeText(workspaceUrl);
                      toast.success("Domain copied");
                    }
                  }}
                  className="min-w-0 cursor-pointer truncate text-left font-mono text-[12.5px] text-[#e2c47c] underline decoration-dotted underline-offset-2 transition-colors hover:text-primary"
                  title={workspaceDisplayUrl || ""}
                >
                  {workspaceDisplayUrl}
                </button>
              </div>
            )}
            {workspace.hasAccessCredential && (
              <div className="flex items-center gap-2 mt-0.5 min-w-0">
                <KeyRound className="size-3.5 shrink-0" />
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="select-none text-[13px] text-fg-3">
                    {isT3 ? "Pairing link" : "*".repeat(16)}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const credential = await revealAccessCredential();
                      if (!credential || !workspace.subdomain) return;
                      if (isT3) {
                        navigator.clipboard.writeText(
                          getT3PairingUrl(workspace.subdomain, credential),
                        );
                        toast.success("Pairing link copied. It works once.");
                      } else {
                        navigator.clipboard.writeText(credential);
                        toast.success("Password copied");
                      }
                    }}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-fill-2 px-2 py-0.5 text-[12.5px] font-medium text-fg-2 transition-colors hover:bg-fill hover:text-fg"
                    title={isT3 ? "Copy one-time pairing link" : "Copy server password"}
                  >
                    <Copy className="size-3" />
                    Copy
                  </button>
                  {isT3 && isRunning && (
                    <button
                      type="button"
                      disabled={regenerateAccessCredentialMutation.isPending}
                      onClick={() =>
                        regenerateAccessCredentialMutation.mutate({ workspaceId: workspace.id })
                      }
                      className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-fill-2 px-2 py-0.5 text-[12.5px] font-medium text-fg-2 transition-colors hover:bg-fill hover:text-fg disabled:opacity-60"
                      title="Pairing links are one-time; generate a new one for another device"
                    >
                      {regenerateAccessCredentialMutation.isPending ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Plus className="size-3" />
                      )}
                      New link
                    </button>
                  )}
                </div>
              </div>
            )}
            {canPairOpencode && isRunning && (
              <div className="flex items-center gap-2 mt-0.5 min-w-0">
                <Link2 className="size-3.5 shrink-0" />
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-[13px] text-fg-3">Desktop pairing link</span>
                  <button
                    type="button"
                    onClick={() => {
                      trackConnection("desktop");
                      void copyOpencodePairingLink(workspace.id);
                    }}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-fill-2 px-2 py-0.5 text-[12.5px] font-medium text-fg-2 transition-colors hover:bg-fill hover:text-fg"
                    title="Copy a one-time link for Connect server in the OpenCode desktop app"
                  >
                    <Copy className="size-3" />
                    Copy
                  </button>
                </div>
              </div>
            )}
            {isOpencode && isRunning && (
              <div className="flex items-center gap-2 mt-0.5 min-w-0">
                <Folder className="size-3.5 shrink-0" />
                <button
                  onClick={() => copyValue(projectPath, "Project path copied")}
                  className="min-w-0 cursor-pointer truncate text-left font-mono text-[12.5px] text-fg-3 underline decoration-dotted underline-offset-2 transition-colors hover:text-fg"
                  title="Copy project path and paste it into OpenCode when opening this workspace's project"
                >
                  {projectPath}
                </button>
              </div>
            )}
            {workspace.editorAccessEnabled && (
              <div className="flex items-center gap-2 mt-0.5 min-w-0">
                <Monitor className="size-3.5 shrink-0" />
                <span>Editor access on</span>
              </div>
            )}
            {((workspace.exposedPorts && Object.keys(workspace.exposedPorts).length > 0) ||
              isRunning) && (
              <div className="flex items-start gap-2 mt-0.5 min-w-0">
                <EthernetPort className="size-3.5 shrink-0 mt-px" />
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  {workspace.exposedPorts &&
                    Object.entries(workspace.exposedPorts).map(([port, exposedPort]) => {
                      const portNum = parseInt(port, 10);
                      const isClosing = closingPort === portNum;
                      const isPublic = exposedPort.visibility === "public";
                      const isUpdatingVisibility =
                        setPortVisibilityMutation.isPending &&
                        setPortVisibilityMutation.variables?.workspaceId === workspace.id &&
                        setPortVisibilityMutation.variables?.port === portNum;
                      return (
                        <div key={port} className="flex items-center gap-1.5 min-w-0">
                          <span className="flex min-w-0 items-center gap-1.5 truncate">
                            <Link
                              href={portUrl(portNum) ?? ("#" as any)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-md bg-fill-2 px-1.5 py-0.5 font-mono text-[12.5px] text-[#e2c47c] transition-colors hover:bg-primary/12"
                              title={`Open :${port} in browser`}
                            >
                              :{port}
                            </Link>
                            <span className="truncate text-fg-3">
                              {exposedPort.name ? `(${exposedPort.name})` : "(Port)"}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setPortVisibilityMutation.mutate({
                                workspaceId: workspace.id,
                                port: portNum,
                                visibility: isPublic ? "private" : "public",
                              })
                            }
                            disabled={isUpdatingVisibility}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] text-fg-4 transition-colors hover:bg-fill-2 hover:text-fg-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-70"
                            title={
                              isPublic
                                ? "Public: anyone with the URL can reach this port. Click to make private."
                                : "Private: only your signed-in browser can reach this port. Click to make public."
                            }
                            aria-label={
                              isPublic ? `Make port ${port} private` : `Make port ${port} public`
                            }
                          >
                            {isUpdatingVisibility ? (
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
                            onClick={() => {
                              setClosingPort(portNum);
                              closeWorkspacePortMutation.mutate({
                                workspaceId: workspace.id,
                                port: portNum,
                              });
                            }}
                            disabled={isClosing}
                            className="shrink-0 rounded-md p-1 text-fg-4 transition-colors hover:bg-red-500/10 hover:text-red-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-70"
                            aria-label={`Remove port ${port}`}
                          >
                            {isClosing ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <X className="size-3" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  {isRunning && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowOpenPortDialog(true);
                        setOpenPortForm(EMPTY_OPEN_PORT_FORM);
                      }}
                      className={`inline-flex w-fit items-center gap-1 rounded text-[13px] text-fg-3 transition-colors hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                        workspace.exposedPorts && Object.keys(workspace.exposedPorts).length > 0
                          ? "mt-0.5"
                          : ""
                      }`}
                      aria-label="Open port"
                    >
                      <Plus className="size-3.5" />
                      Open port
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 px-5 pt-1 pb-5">
          {isRunning &&
            workspaceUrl &&
            (workspace.serverOnly ? (
              <div className="flex gap-2 flex-1">
                {isT3 ? (
                  <Button
                    size="sm"
                    className="h-9 flex-1"
                    disabled={!workspace.hasAccessCredential}
                    title="Open in the T3 Code desktop app (one-time pairing link)"
                    onClick={async () => {
                      const credential = await revealAccessCredential();
                      if (credential && workspace.subdomain) {
                        trackConnection("desktop");
                        window.location.href = getT3DesktopPairingUrl(
                          workspace.subdomain,
                          credential,
                        );
                      }
                    }}
                  >
                    <ExternalLink className="size-3.5" />
                    Open in T3
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-9 flex-1"
                    title="Copy a command that opens this workspace in your local terminal UI"
                    onClick={async () => {
                      if (!workspace.subdomain) return;
                      let command: string | undefined;
                      if (canPairOpencode) {
                        // A paired session token keeps the permanent password out of shells.
                        // Older servers cannot pair; fall back to the password command.
                        command = await opencodeSessionAttachCommand(workspace.id).catch(
                          () => undefined,
                        );
                      }
                      command ??= getAttachCommand(
                        workspace.subdomain,
                        workspace.image.agentType.name,
                        await revealAccessCredential(),
                      );
                      await navigator.clipboard.writeText(command);
                      trackConnection("cli");
                      toast.success("Attach command copied", {
                        description: "Paste it into your terminal and press Enter to open the TUI.",
                      });
                    }}
                  >
                    <Copy className="size-3.5" />
                    Attach TUI
                  </Button>
                )}
                {workspace.editorAccessEnabled && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-9 flex-1"
                    onClick={() => setShowConnectDialog(true)}
                  >
                    <Terminal className="size-3.5" />
                    Editor
                  </Button>
                )}
                {isT3 ? (
                  <Button
                    size="sm"
                    className="h-9 px-3"
                    variant="outline"
                    disabled={!workspace.hasAccessCredential}
                    title="Open in the T3 web app (browser)"
                    onClick={async () => {
                      const credential = await revealAccessCredential();
                      if (credential && workspace.subdomain) {
                        trackConnection("browser");
                        window.location.href = getT3PairingUrl(workspace.subdomain, credential);
                      }
                    }}
                  >
                    <Globe className="size-3.5" />
                  </Button>
                ) : canPairOpencode ? (
                  <Button
                    size="sm"
                    className="h-9 px-3"
                    variant="outline"
                    title="Open the OpenCode web app, already signed in"
                    onClick={() => {
                      trackConnection("browser");
                      void openOpencodeInBrowser(workspace.id, workspaceUrl);
                    }}
                  >
                    <Globe className="size-3.5" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-9 px-3"
                    variant="outline"
                    title="Open workspace in browser"
                    asChild
                  >
                    <a
                      href={workspaceUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => trackConnection("browser")}
                    >
                      <Globe className="size-3.5" />
                    </a>
                  </Button>
                )}
              </div>
            ) : (
              <Button size="sm" className="h-9 flex-1" asChild>
                <a
                  href={workspaceUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => trackConnection("browser")}
                >
                  <ExternalLink className="size-3.5" />
                  Open workspace
                </a>
              </Button>
            ))}
          {isPaused && (
            <Button
              size="sm"
              className="h-9 flex-1"
              disabled={restartWorkspaceMutation.isPending}
              onClick={() => restartWorkspaceMutation.mutate({ workspaceId: workspace.id })}
            >
              {restartWorkspaceMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PlayCircle className="size-3.5" />
              )}
              Restart
            </Button>
          )}

          {workspace.hostingType === "cloud" && (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-9 px-3",
                workspace.alwaysOn &&
                  "bg-primary/12 text-[#e2c47c] shadow-[inset_0_0_0_1px_rgba(211,173,85,0.3)] hover:bg-primary/20 hover:text-[#e2c47c]",
              )}
              title={
                workspace.alwaysOn
                  ? "Always on: click to pause when idle"
                  : "Keep running when idle"
              }
              aria-pressed={workspace.alwaysOn}
              disabled={setAlwaysOnMutation.isPending}
              onClick={() =>
                setAlwaysOnMutation.mutate({
                  workspaceId: workspace.id,
                  alwaysOn: !workspace.alwaysOn,
                })
              }
            >
              {setAlwaysOnMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <InfinityIcon className="size-3.5" />
              )}
            </Button>
          )}

          {(isPending || isRunning) && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3"
              title="Pause"
              aria-label="Pause workspace"
              disabled={pauseWorkspaceMutation.isPending}
              onClick={() => pauseWorkspaceMutation.mutate({ workspaceId: workspace.id })}
            >
              {pauseWorkspaceMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PauseIcon className="size-3.5" />
              )}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 hover:bg-red-500/10 hover:text-red-300"
            title="Terminate"
            aria-label="Terminate workspace"
            disabled={deleteServiceMutation.isPending}
            onClick={() => deleteServiceMutation.mutate({ workspaceId: workspace.id })}
          >
            {deleteServiceMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
