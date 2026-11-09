"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Loader2, RefreshCw, SquareArrowOutUpRight } from "lucide-react";
import { encode } from "uqr";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { CopyField } from "@/components/dashboard/copy-field";
import {
  createOpencodePairing,
  type startOpencodePairing,
} from "@/components/dashboard/opencode-connect";
import type { Workspace } from "./workspace-meta";

type WorkspaceSSHAccess =
  (typeof trpc.workspace.getWorkspaceSSHAccess)["~types"]["output"]["access"];

const invalidateWorkspaces = () =>
  queryClient.invalidateQueries({ queryKey: trpc.workspace.listWorkspaces.queryKey() });

const EDITORS = [
  { name: "VS Code", protocol: "vscode", icon: "/vscode.svg" },
  { name: "Cursor", protocol: "cursor", icon: "/cursor.svg" },
  { name: "Zed", protocol: "zed", icon: "/zed.svg" },
];

function editorUri(protocol: string, remoteTarget: string, projectPathHint: string) {
  if (protocol === "zed") return `zed://ssh/${remoteTarget}${projectPathHint}`;
  return `${protocol}://vscode-remote/ssh-remote+${remoteTarget}${projectPathHint}`;
}

/** SSH details and one-click links for VS Code, Cursor and Zed. */
export function EditorAccessDialog({
  workspace,
  open,
  onOpenChange,
  onConnect,
}: {
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: () => void;
}) {
  const accessQuery = useQuery({
    ...trpc.workspace.getWorkspaceSSHAccess.queryOptions({ workspaceId: workspace.id }),
    enabled: open && workspace.editorAccessEnabled && workspace.status === "running",
    retry: false,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect an editor</DialogTitle>
          <DialogDescription>Connect from your preferred editor over SSH.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          {accessQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-xl bg-fill p-4 text-sm text-fg-3">
              <Loader2 className="size-4 animate-spin" />
              Preparing SSH access…
            </div>
          ) : accessQuery.error ? (
            <div className="rounded-xl bg-[#fb923c]/10 p-4 text-sm text-[#fb923c]">
              {accessQuery.error.message}
            </div>
          ) : accessQuery.data ? (
            <EditorAccess access={accessQuery.data.access} onConnect={onConnect} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditorAccess({
  access,
  onConnect,
}: {
  access: WorkspaceSSHAccess;
  onConnect: () => void;
}) {
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
      {!needsSshConfig && <CopyField label="SSH command" value={access.sshCommand} />}

      {!needsProxySetup && needsSshConfig && (
        <div className="grid gap-2">
          <div>
            <p className="text-[13px] font-medium text-fg-2">One-time SSH config</p>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-3">
              Railway uses a TCP proxy on port {access.port}. Add this to <code>~/.ssh/config</code>
              , then use the editor buttons below.
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
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-fill-2 text-[12px] font-semibold text-primary">
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

      <div className="grid gap-2">
        <p className="text-[13px] font-medium text-fg-2">Open in editor</p>
        <div className="grid gap-1.5">
          {EDITORS.map((editor) => (
            <a
              key={editor.protocol}
              href={editorUri(editor.protocol, remoteTarget, access.projectPathHint)}
              onClick={onConnect}
              className="flex items-center gap-3 rounded-xl bg-fill px-3 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-fill-2"
            >
              <Image src={editor.icon} alt="" width={18} height={18} className="size-[18px]" />
              <span className="flex-1">Open in {editor.name}</span>
              <SquareArrowOutUpRight className="size-3.5 text-fg-4" />
            </a>
          ))}
        </div>
      </div>

      {needsSshConfig && (
        <details className="text-[13px] text-fg-3">
          <summary className="cursor-pointer list-none font-medium text-fg-3 transition-colors hover:text-fg">
            Manual SSH command
          </summary>
          <CopyField value={access.sshCommand} className="mt-2" />
        </details>
      )}

      <CopyField
        label="SSH target for Neovim and other editors"
        value={access.sshConnectionString}
      />

      <p className="text-[13px] text-fg-3">
        Project path: <code className="font-mono text-fg-2">{access.projectPathHint}</code>
        {access.expiresAt && (
          <span className="ml-2">
            Expires {formatDistanceToNow(new Date(access.expiresAt), { addSuffix: true })}
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
}

const EMPTY_PORT_FORM = { name: "", port: "", isPublic: false };

/** Expose a port from the workspace at its own URL. */
export function OpenPortDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState(EMPTY_PORT_FORM);
  const close = () => {
    onOpenChange(false);
    setForm(EMPTY_PORT_FORM);
  };
  const openPort = useMutation(
    trpc.workspace.openWorkspacePort.mutationOptions({
      onSuccess: () => {
        toast.success("Port opened");
        void invalidateWorkspaces();
        close();
      },
      onError: (error) => toast.error(`Failed to open port: ${error.message}`),
    }),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Open a port</DialogTitle>
          <DialogDescription>
            Reach a server running in {workspace.name} at a URL.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const port = parseInt(form.port, 10);
            if (isNaN(port) || port < 1 || port > 65535) {
              toast.error("Port must be between 1 and 65535");
              return;
            }
            openPort.mutate({
              workspaceId: workspace.id,
              port,
              name: form.name.trim() || undefined,
              visibility: form.isPublic ? "public" : "private",
            });
          }}
        >
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="port-num">Port</Label>
              <Input
                id="port-num"
                type="number"
                min={1}
                max={65535}
                autoFocus
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                placeholder="3000"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port-name">Name</Label>
              <Input
                id="port-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Optional, e.g. API"
              />
            </div>
            <div className="flex items-start justify-between gap-4 rounded-xl bg-fill px-3.5 py-3">
              <div className="grid gap-1">
                <Label htmlFor="port-public">Public URL</Label>
                <p className="text-[13px] leading-relaxed text-fg-3">
                  {form.isPublic
                    ? "Anyone with the URL can reach this port. Use this for APIs and webhooks."
                    : "Only you can reach this port, from a browser signed in to GitTerm."}
                </p>
              </div>
              <Switch
                id="port-public"
                checked={form.isPublic}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, isPublic: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={openPort.isPending}>
              {openPort.isPending && <Loader2 className="size-4 animate-spin" />}
              Open port
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Terminating removes the workspace's cloud resources, so it asks first. */
export function TerminateDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const terminate = useMutation(
    trpc.workspace.deleteWorkspace.mutationOptions({
      onSuccess: (data) => {
        toast.success(
          data.cleanupInBackground
            ? "Workspace terminated. Cloud cleanup continues in the background."
            : "Workspace terminated",
        );
        onOpenChange(false);
        void invalidateWorkspaces();
      },
      onError: (error) => toast.error(`Failed to terminate workspace: ${error.message}`),
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Terminate {workspace.name}?</DialogTitle>
          <DialogDescription>
            It stops for good and its cloud resources are removed. Push any work you want to keep
            first.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={terminate.isPending}
            onClick={() => terminate.mutate({ workspaceId: workspace.id })}
          >
            {terminate.isPending && <Loader2 className="size-4 animate-spin" />}
            Terminate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OpencodePairing = Awaited<ReturnType<typeof createOpencodePairing>>;
type StartedPairing = ReturnType<typeof startOpencodePairing>;

// The dialog takes 200ms to open; "Copied" shows just after, where it will be seen.
const AFTER_OPEN_MS = 350;

/**
 * Pairs the OpenCode app, on a phone or a computer, with a one-time code. The app trades the code
 * for its own session, so the server password never leaves GitTerm.
 */
export function OpencodeAppDialog({
  workspaceId,
  started,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  /** The code the opening click created, with whether it copied the link. */
  started: StartedPairing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {/* Mounted only while open: each opening gets a fresh code, and none is kept after. */}
        <OpencodeAppPairing workspaceId={workspaceId} started={started} />
      </DialogContent>
    </Dialog>
  );
}

function OpencodeAppPairing({
  workspaceId,
  started,
}: {
  workspaceId: string;
  started: StartedPairing | null;
}) {
  // On a phone the app is on this same device, so the link to paste comes first.
  const [onPhone] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const [showQr, setShowQr] = useState(!onPhone);
  const [pairing, setPairing] = useState<OpencodePairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [justCopied, setJustCopied] = useState(false);

  const show = useCallback((next: Promise<OpencodePairing>) => {
    setPairing(null);
    setError(null);
    setExpired(false);
    setJustCopied(false);
    next.then(setPairing, (e: unknown) =>
      setError(e instanceof Error ? e.message : "Couldn't create a code"),
    );
  }, []);

  // A new code is ready before Copy is pressed: iOS Safari won't copy after a network request.
  const newCode = () => show(createOpencodePairing(workspaceId));

  useEffect(() => {
    if (!started) return show(createOpencodePairing(workspaceId));
    // The click that opened the dialog already made a code and copied its link.
    show(started.pairing);
    let mounted = true;
    const opened = new Promise((resolve) => setTimeout(resolve, AFTER_OPEN_MS));
    void Promise.all([started.copied, opened]).then(([copied]) => {
      if (mounted && copied) setJustCopied(true);
    });
    return () => {
      mounted = false;
    };
  }, [started, show, workspaceId]);

  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(
      () => setExpired(true),
      new Date(pairing.expiresAt).getTime() - Date.now(),
    );
    return () => clearTimeout(timer);
  }, [pairing]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect the OpenCode app</DialogTitle>
        <DialogDescription>
          {onPhone
            ? "Copy the link and paste it into the OpenCode app when you add a server. Opening it here uses it up."
            : "Scan the code with the OpenCode app on your phone, or paste the link into Connect server in the desktop app."}
        </DialogDescription>
      </DialogHeader>

      {error || expired ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line px-6 py-8 text-center">
          <p className="text-[13.5px] text-fg-3">{error ?? "This code expired."}</p>
          <Button size="sm" variant="secondary" onClick={newCode}>
            <RefreshCw className="size-3.5" />
            New code
          </Button>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4">
          {showQr &&
            (pairing ? (
              // Black on white whatever the theme, so every camera reads it.
              <div className="mx-auto size-52 rounded-xl bg-white p-3 text-black">
                <QrCode value={JSON.stringify({ code: pairing.code, urls: [pairing.url] })} />
              </div>
            ) : (
              <Skeleton className="mx-auto size-52 rounded-xl bg-fill-2" />
            ))}
          {pairing ? (
            <CopyField label="Pairing link" value={pairing.link} announceCopied={justCopied} />
          ) : (
            <Skeleton className="h-[62px] rounded-lg bg-fill-2" />
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[12.5px] whitespace-nowrap text-fg-3">
            <span>Works once, for 5 minutes.</span>
            <span className="flex items-center gap-4">
              {!showQr && (
                <button type="button" className="hover:text-fg" onClick={() => setShowQr(true)}>
                  Show QR code
                </button>
              )}
              <button type="button" className="hover:text-fg" onClick={newCode}>
                New code
              </button>
            </span>
          </div>
        </div>
      )}
    </>
  );
}

/** Draws a QR code as one SVG path, a square per dark module. */
function QrCode({ value }: { value: string }) {
  const { data, size } = encode(value, { border: 0 });
  const squares = data.flatMap((row, y) =>
    row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : "")),
  );
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="size-full"
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code for the OpenCode app"
    >
      <path d={squares.join("")} fill="currentColor" />
    </svg>
  );
}
