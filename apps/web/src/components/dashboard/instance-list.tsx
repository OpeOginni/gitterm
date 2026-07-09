"use client";

import { trpc, queryClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  ExternalLink,
  Trash2,
  PlayCircle,
  GitBranch,
  Clock,
  Globe,
  Box,
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
  X,
  Plus,
  KeyRound,
  SquareArrowOutUpRight,
  UserPlus,
  UsersRound,
  User,
  Shield,
  LogOut,
} from "lucide-react";
import Image from "next/image";
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
import {
  getWorkspaceUrl,
  getAttachCommand,
  getWorkspaceDisplayUrl,
  getWorkspaceOpenPortUrl,
} from "@/lib/utils";
import Link from "next/link";
import { ShareWorkspaceDialog } from "@/components/dashboard/share/share-workspace-dialog";

const ITEMS_PER_PAGE = 6;

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
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-sm text-muted-foreground">Loading workspaces...</p>
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
      <div className="flex h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03]">
          <Terminal className="h-7 w-7 text-white/30" />
        </div>
        <h3 className="mt-5 text-lg font-medium text-white/80">No active workspaces</h3>
        <p className="mt-2 max-w-sm text-sm text-white/35">
          Connect a GitHub repo and launch a workspace that can clone, commit, push, and open pull
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
        <div className="flex items-center justify-between pt-4 border-t border-white/[0.06]">
          <p className="text-sm text-white/30">
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
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <span className="text-sm text-white/30 px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!pagination.hasMore || workspacesQuery.isFetching}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
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

export type SharedAccess = {
  role: string;
  via: { kind: "user" } | { kind: "team"; teamName: string };
  owner: { name: string; email: string } | null;
};

export function InstanceCard({
  workspace,
  providers,
  shared,
}: {
  workspace: Workspace;
  providers: CloudProvider[];
  /** When set, renders a read-only card for a workspace shared with the user. */
  shared?: SharedAccess;
}) {
  const isShared = !!shared;
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showOpenPortDialog, setShowOpenPortDialog] = useState(false);
  const [openPortForm, setOpenPortForm] = useState({ name: "", port: "" });
  const [closingPort, setClosingPort] = useState<number | null>(null);

  const deleteServiceMutation = useMutation(
    trpc.workspace.deleteWorkspace.mutationOptions({
      onSuccess: (data) => {
        toast.success(
          data.cleanupInBackground
            ? "Workspace removed. AWS cleanup is continuing in the background."
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

  const leaveSharedMutation = useMutation(
    trpc.workspaceShare.leaveSharedWorkspace.mutationOptions({
      onSuccess: () => {
        toast.success("You've left this workspace");
        queryClient.invalidateQueries({
          queryKey: trpc.workspaceShare.listSharedWorkspaces.queryKey(),
        });
      },
      onError: (error) => {
        toast.error(error.message);
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

  const restartWorkspaceMutation = useMutation(
    trpc.workspace.restartWorkspace.mutationOptions({
      onSuccess: (data) => {
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

  const openWorkspacePortMutation = useMutation(
    trpc.workspace.openWorkspacePort.mutationOptions({
      onSuccess: () => {
        toast.success("Port opened successfully");
        queryClient.invalidateQueries({
          queryKey: trpc.workspace.listWorkspaces.queryKey(),
        });
        setShowOpenPortDialog(false);
        setOpenPortForm({ name: "", port: "" });
      },
      onError: (error) => {
        toast.error(`Failed to open port: ${error.message}`);
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
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Running
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-medium text-white/50">
            <Loader2 className="h-3 w-3 animate-spin" />
            Pending
          </span>
        );
      case "paused":
        return (
          <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-medium text-white/40">
            Paused
          </span>
        );
      case "terminated":
        return (
          <span className="inline-flex items-center rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 text-[11px] font-medium text-red-400">
            Terminated
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-medium text-white/40">
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
    if (!provider) return { name: "Unknown", location: "Unknown", providerName: "Unknown" };

    const region = provider.regions?.find((r: any) => r.id === workspace.regionId);
    return {
      name: region?.name || "Unknown",
      location: region?.location || "Unknown",
      providerName: provider.name,
    };
  };

  const regionInfo = getRegionInfo();
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

  const portUrl = (port: number) =>
    workspace.subdomain ? getWorkspaceOpenPortUrl(workspace.subdomain, port) : null;

  const copyValue = async (value: string, successMessage: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
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
            copied: "Install command copied",
          },
          {
            label: "Add this to ~/.ssh/config",
            help: "Paste the snippet into the SSH config file on your machine.",
            value: access.sshConfigSnippet,
            copied: "SSH config copied",
          },
        ]
      : [];

    return (
      <div className="grid gap-4">
        {!needsSshConfig && (
          <div className="grid gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              SSH command
            </p>
            <div
              className="group relative cursor-pointer rounded-lg border border-border/50 bg-secondary/30 px-4 py-3 transition-colors hover:bg-secondary/50"
              onClick={() => copyValue(access.sshCommand, "SSH command copied")}
            >
              <code className="block text-sm font-medium text-foreground break-all pr-8">
                {access.sshCommand}
              </code>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 transition-opacity group-hover:opacity-100">
                <Copy className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>
        )}

        {!needsProxySetup && needsSshConfig && (
          <div className="grid gap-2 rounded-xl border border-border/50 bg-secondary/15 p-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                One-time SSH config
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Railway uses a TCP proxy on port {access.port}. Add this to{" "}
                <code>~/.ssh/config</code>, then use the editor buttons below.
              </p>
            </div>
            <button
              type="button"
              className="group relative w-full cursor-pointer rounded-md border border-border/40 bg-secondary/30 px-3 py-2 text-left transition-colors hover:bg-secondary/50"
              onClick={() => copyValue(access.sshConfigSnippet, "SSH config copied")}
            >
              <code className="block max-h-24 overflow-y-auto whitespace-pre-wrap break-all pr-7 text-xs font-medium text-foreground">
                {access.sshConfigSnippet}
              </code>
              <Copy className="absolute right-2.5 top-2.5 h-3.5 w-3.5 opacity-40 transition-opacity group-hover:opacity-100" />
            </button>
          </div>
        )}

        {needsProxySetup && (
          <div className="grid gap-2 rounded-xl border border-border/50 bg-secondary/15 p-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                One-time local setup
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                E2B needs a local proxy. Do these once, then use the editor buttons below.
              </p>
            </div>
            {setupSteps.map((step, index) => (
              <div
                key={step.label}
                className="grid gap-2 rounded-lg border border-border/40 bg-background/40 p-3"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.help}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="group relative w-full cursor-pointer rounded-md border border-border/40 bg-secondary/30 px-3 py-2 text-left transition-colors hover:bg-secondary/50"
                  onClick={() => copyValue(step.value, step.copied)}
                >
                  <code className="block max-h-24 overflow-y-auto whitespace-pre-wrap break-all pr-7 text-xs font-medium text-foreground">
                    {step.value}
                  </code>
                  <Copy className="absolute right-2.5 top-2.5 h-3.5 w-3.5 opacity-40 transition-opacity group-hover:opacity-100" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Open in editor buttons */}
        <div className="grid gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Open in editor
          </p>
          <div className="grid gap-1.5">
            {editorProtocols.map((editor) => (
              <a
                key={editor.protocol}
                href={buildEditorUri(editor.protocol, remoteTarget, access.projectPathHint)}
                className="flex items-center gap-3 rounded-lg border border-border/40 bg-secondary/20 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/40 hover:border-border/60"
              >
                <Image
                  src={editor.icon}
                  alt={editor.name}
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px]"
                />
                <span className="flex-1">Open in {editor.name}</span>
                <SquareArrowOutUpRight className="h-3.5 w-3.5 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>

        {needsSshConfig && (
          <details className="group rounded-lg border border-border/40 bg-secondary/10 px-3 py-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer list-none font-medium text-muted-foreground transition-colors hover:text-foreground">
              Manual SSH command
            </summary>
            <button
              type="button"
              className="group/copy relative mt-2 w-full cursor-pointer rounded-md border border-border/40 bg-secondary/30 px-3 py-2 text-left transition-colors hover:bg-secondary/50"
              onClick={() => copyValue(access.sshCommand, "SSH command copied")}
            >
              <code className="block max-h-24 overflow-y-auto break-all pr-7 text-xs font-medium text-foreground">
                {access.sshCommand}
              </code>
              <Copy className="absolute right-2.5 top-2.5 h-3.5 w-3.5 opacity-40 transition-opacity group-hover/copy:opacity-100" />
            </button>
          </details>
        )}

        {/* Copy connection string for Neovim / other editors */}
        <div className="grid gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Copy SSH target for Neovim / other editors
          </p>
          <div
            className="group relative cursor-pointer rounded-lg border border-border/50 bg-secondary/30 px-4 py-3 transition-colors hover:bg-secondary/50"
            onClick={() => copyValue(access.sshConnectionString, "Connection string copied")}
          >
            <code className="block text-sm font-medium text-foreground break-all pr-8">
              {access.sshConnectionString}
            </code>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 transition-opacity group-hover:opacity-100">
              <Copy className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Project path: <code className="text-foreground/80">{access.projectPathHint}</code>
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
          <div className="grid gap-1.5 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5 text-xs text-muted-foreground">
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
      {!isShared && (
        <ShareWorkspaceDialog
          workspaceId={workspace.id}
          workspaceName={workspace.name || getRepoName() || "Untitled workspace"}
          open={showShareDialog}
          onOpenChange={setShowShareDialog}
        />
      )}

      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">Editor Connect</DialogTitle>
            <DialogDescription>Connect from your preferred editor over SSH.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            {editorAccessQuery.isLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing SSH access...
              </div>
            ) : editorAccessQuery.error ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
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
          if (!open) setOpenPortForm({ name: "", port: "" });
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Open workspace port</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Expose a port from this workspace. Enter a short name and the port number.
            </DialogDescription>
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
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowOpenPortDialog(false)}
                className="border-border/50"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={openWorkspacePortMutation.isPending}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {openWorkspacePortMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Open port"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="group flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-card transition-all hover:border-white/[0.12]">
        <div className="px-5 pt-5 pb-3">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.04]">
                  <Box className="h-5 w-5 text-primary" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-white/90 truncate">
                    {workspace.name || workspace.subdomain}
                  </span>
                  <span className="text-xs text-white/30 truncate">
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
                  className="flex items-center gap-2 text-xs text-white/30 min-w-0 pl-12 transition-colors hover:text-white/60"
                >
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-mono underline decoration-white/15 underline-offset-2 hover:decoration-white/40">
                    {getRepoName()}
                  </span>
                </a>
              ) : (
                <div className="flex items-center gap-2 text-xs text-white/30 min-w-0 pl-12">
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-mono" title={workspace.repositoryUrl || ""}>
                    {getRepoName()}
                  </span>
                </div>
              ))}
          </div>
        </div>
        <div className="pb-4 px-5 flex-1">
          <div className="grid gap-2.5 text-xs text-white/35 pl-12">
            {shared && (
              <div className="flex items-center gap-2 min-w-0">
                {shared.via.kind === "team" ? (
                  <>
                    <UsersRound className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                    <span className="truncate text-primary/70">
                      Via team {shared.via.teamName} · {shared.role}
                    </span>
                  </>
                ) : (
                  <>
                    <Shield className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                    <span className="truncate text-primary/70">
                      Shared directly with you · {shared.role}
                    </span>
                  </>
                )}
              </div>
            )}
            {shared?.owner && (
              <div className="flex items-center gap-2 min-w-0">
                <User className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate" title={shared.owner.email}>
                  Created by {shared.owner.name}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {regionInfo.name} · {regionInfo.location}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Server className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{regionInfo.providerName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {formatDistanceToNow(new Date(workspace.startedAt), {
                  addSuffix: true,
                })}
              </span>
            </div>
            {workspace.lastActiveAt && isRunning && (
              <div className="flex items-center gap-2">
                <HeartPlusIcon className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                <span className="truncate text-primary/70">
                  Active{" "}
                  {formatDistanceToNow(new Date(workspace.lastActiveAt), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            )}
            {workspace.domain && isRunning && (
              <div className="flex items-center gap-2 mt-0.5 min-w-0">
                <Globe className="h-3.5 w-3.5 shrink-0 text-primary/60" />
                <button
                  onClick={() => {
                    if (workspaceUrl) {
                      navigator.clipboard.writeText(workspaceUrl);
                      toast.success("Domain copied!");
                    }
                  }}
                  className="text-xs font-mono text-primary/80 hover:text-primary truncate transition-colors cursor-pointer underline decoration-dotted underline-offset-2 text-left min-w-0"
                  title={workspaceDisplayUrl || ""}
                >
                  {workspaceDisplayUrl}
                </button>
              </div>
            )}
            {workspace.serverOnly && workspace.serverPassword && (
              <div className="flex items-center gap-2 mt-0.5 min-w-0">
                <KeyRound className="h-3.5 w-3.5 shrink-0 text-amber-400/60" />
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-xs font-mono text-white/40 tracking-widest select-none">
                    {"*".repeat(16)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (workspace.serverPassword) {
                        navigator.clipboard.writeText(workspace.serverPassword);
                        toast.success("Password copied to clipboard!");
                      }
                    }}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-amber-400/70 bg-amber-400/[0.06] border border-amber-400/[0.1] hover:bg-amber-400/[0.12] hover:text-amber-400 transition-colors cursor-pointer"
                    title="Copy server password"
                  >
                    <Copy className="h-2.5 w-2.5" />
                    Copy
                  </button>
                </div>
              </div>
            )}
            {workspace.editorAccessEnabled && (
              <div className="flex items-center gap-2 mt-0.5 min-w-0">
                <Monitor className="h-3.5 w-3.5 shrink-0" />
                <span className="text-xs text-white/30">Editor access enabled</span>
              </div>
            )}
            {!isShared &&
              ((workspace.exposedPorts && Object.keys(workspace.exposedPorts).length > 0) ||
                isRunning) && (
                <div className="flex items-start gap-2 mt-0.5 min-w-0">
                  <EthernetPort className="h-3.5 w-3.5 shrink-0 mt-px" />
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    {workspace.exposedPorts &&
                      Object.entries(workspace.exposedPorts).map(([port, exposedPort]) => {
                        const portNum = parseInt(port, 10);
                        const isClosing = closingPort === portNum;
                        return (
                          <div key={port} className="flex items-center gap-1.5 min-w-0">
                            <span className="flex items-center gap-1 text-xs min-w-0 truncate">
                              <Link
                                href={portUrl(portNum) ?? ("#" as any)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="bg-muted px-1.5 py-0.5 rounded font-mono text-primary/90 border border-border hover:bg-primary/10 transition-colors"
                                title={`Open :${port} in browser`}
                              >
                                :{port}
                              </Link>
                              <span className="text-muted-foreground">
                                {exposedPort.name ? `(${exposedPort.name})` : "(Port)"}
                              </span>
                            </span>
                            {!isShared && (
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
                                className="shrink-0 p-0.5 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-70"
                                aria-label={`Remove port ${port}`}
                              >
                                {isClosing ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <X className="h-3 w-3" />
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    {isRunning && !isShared && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowOpenPortDialog(true);
                          setOpenPortForm({ name: "", port: "" });
                        }}
                        className={`inline-flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-primary transition-colors w-fit focus:outline-none focus:ring-1 focus:ring-ring focus:ring-offset-0 rounded ${
                          workspace.exposedPorts && Object.keys(workspace.exposedPorts).length > 0
                            ? "mt-0.5"
                            : ""
                        }`}
                        aria-label="Open port"
                      >
                        <Plus className="h-3 w-3" />
                        Open port
                      </button>
                    )}
                  </div>
                </div>
              )}
          </div>
        </div>
        <div className="flex gap-2 border-t border-white/[0.06] p-4">
          {isRunning &&
            workspaceUrl &&
            (workspace.serverOnly ? (
              <div className="flex gap-2 flex-1">
                <Button
                  size="sm"
                  className="h-9 flex-1 text-xs gap-2 bg-primary/80 text-primary-foreground hover:bg-primary/90"
                  onClick={() => {
                    if (workspace.subdomain) {
                      const command = getAttachCommand(
                        workspace.subdomain,
                        workspace.image.agentType.name,
                        workspace.serverPassword,
                      );
                      navigator.clipboard.writeText(command);
                      toast.success("Attach command copied to clipboard!");
                    }
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Attach
                </Button>
                {!isShared && workspace.editorAccessEnabled && (
                  <Button
                    size="sm"
                    className="h-9 flex-1 text-xs gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
                    onClick={() => setShowConnectDialog(true)}
                  >
                    <Terminal className="h-3.5 w-3.5" />
                    Editor
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-9 text-xs gap-2 border-border/50"
                  variant="outline"
                  asChild
                >
                  <a href={workspaceUrl} target="_blank" rel="noreferrer">
                    <Monitor className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                className="h-9 flex-1 text-xs gap-2 bg-primary/80 text-primary-foreground hover:bg-primary/90"
                asChild
              >
                <a href={workspaceUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Workspace
                </a>
              </Button>
            ))}
          {!isShared && isStopped && (
            <Button
              size="sm"
              className="h-9 flex-1 text-xs gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
              disabled={restartWorkspaceMutation.isPending}
              onClick={() => restartWorkspaceMutation.mutate({ workspaceId: workspace.id })}
            >
              {restartWorkspaceMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              Restart
            </Button>
          )}

          {!isShared && (isPending || isRunning) && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 text-xs"
              disabled={pauseWorkspaceMutation.isPending}
              onClick={() => pauseWorkspaceMutation.mutate({ workspaceId: workspace.id })}
            >
              {pauseWorkspaceMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PauseIcon className="h-3.5 w-3.5" />
              )}
            </Button>
          )}

          {!isShared && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 border-border/50 hover:text-primary hover:border-primary/30"
              onClick={() => setShowShareDialog(true)}
              aria-label="Share workspace"
            >
              <UserPlus className="h-4 w-4" />
            </Button>
          )}

          {!isShared && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 border-border/50 hover:text-destructive hover:bg-destructive/10 hover:border-destructive/20"
              disabled={deleteServiceMutation.isPending}
              onClick={() => deleteServiceMutation.mutate({ workspaceId: workspace.id })}
            >
              {deleteServiceMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          )}

          {isShared && !(isRunning && workspaceUrl) && (
            <Button
              size="sm"
              variant="outline"
              disabled
              className="h-9 flex-1 text-xs border-border/50 opacity-70"
            >
              {isPaused ? "Workspace paused" : "Workspace not running"}
            </Button>
          )}

          {isShared && shared?.via.kind === "user" && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 border-border/50 hover:text-destructive hover:bg-destructive/10 hover:border-destructive/20"
              disabled={leaveSharedMutation.isPending}
              onClick={() => leaveSharedMutation.mutate({ workspaceId: workspace.id })}
              aria-label="Leave shared workspace"
            >
              {leaveSharedMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
