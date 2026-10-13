"use client";

import { Copy, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { opencodeAttachCommand } from "@/lib/opencode-connection";
import { trpcClient } from "@/utils/trpc";

async function copyValue(value: string, message: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(message);
  } catch {
    toast.error("Could not copy to clipboard");
  }
}

export function OpencodeConnect({
  workspaceId,
  url,
  projectPath,
  hasCredential,
  editor,
  onConnect,
}: {
  workspaceId: string;
  url: string;
  projectPath: string;
  hasCredential: boolean;
  editor?: ReactNode;
  onConnect: (method: "desktop" | "cli" | "editor") => void;
}) {
  const [busy, setBusy] = useState(false);

  const copyConnection = async (kind: "link" | "tui") => {
    setBusy(true);
    try {
      // Each click issues its own code; never reuse a link consumed by another client.
      // Use the client directly so secrets are not retained in React Query's mutation cache.
      const result = await trpcClient.workspace.createOpencodeConnection.mutate({
        workspaceId,
        kind,
      });
      const value =
        result.kind === "link" ? result.link : opencodeAttachCommand(result.url, result.token);
      await navigator.clipboard.writeText(value);
      onConnect(kind === "link" ? "desktop" : "cli");
      toast.success(
        kind === "link"
          ? "Pairing link copied. Use it once within 5 minutes."
          : "Attach command copied. It uses a session token, not your server password.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy connection details");
    } finally {
      setBusy(false);
    }
  };

  const copyPassword = async (attach: boolean) => {
    setBusy(true);
    try {
      const { credential } = await trpcClient.workspace.getAccessCredential.mutate({ workspaceId });
      if (!credential) throw new Error("This workspace does not have a server password available");
      await navigator.clipboard.writeText(
        attach ? opencodeAttachCommand(url, credential) : credential,
      );
      if (attach) onConnect("cli");
      toast.success(attach ? "Password-based attach command copied" : "Server password copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy server password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <Tabs defaultValue="app">
        <TabsList className="w-full">
          <TabsTrigger value="app">Desktop / web</TabsTrigger>
          <TabsTrigger value="tui">Terminal</TabsTrigger>
          {editor && (
            <TabsTrigger value="editor" onClick={() => onConnect("editor")}>
              Editor
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="app" className="grid gap-3 pt-3">
          <p className="text-sm text-muted-foreground">
            In a current OpenCode 2 desktop or web app, choose Connect server and paste a pairing
            link. Your saved servers and app preferences stay in that app.
          </p>
          <Button disabled={busy || !hasCredential} onClick={() => copyConnection("link")}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Copy pairing link
          </Button>
          <p className="text-xs text-muted-foreground">
            Links work once and expire after 5 minutes. Copy a fresh link for each device. Paste it
            into the app rather than opening it in your browser.
          </p>
          <p className="text-xs text-muted-foreground">
            Your web frontend must support OpenCode 2. Older hosted versions are incompatible; use
            an up-to-date desktop app or OpenCode 2 web frontend.
          </p>
        </TabsContent>
        <TabsContent value="tui" className="grid gap-3 pt-3">
          <p className="text-sm text-muted-foreground">
            Paste the attach command into your terminal. It connects your local OpenCode 2 TUI using
            a session token instead of the permanent server password.
          </p>
          <Button disabled={busy || !hasCredential} onClick={() => copyConnection("tui")}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Copy attach command
          </Button>
          <p className="text-xs text-muted-foreground">
            The token lasts up to 30 days. Changing the server password signs paired clients out.
            Keep the command private; it contains your session token.
          </p>
        </TabsContent>
        {editor && (
          <TabsContent value="editor" className="pt-3">
            {editor}
          </TabsContent>
        )}
      </Tabs>

      <div className="grid gap-2 border-t border-border/50 pt-4">
        <p className="text-xs font-medium text-muted-foreground">Project path</p>
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-lg border border-border/40 bg-secondary/20 px-3 py-2 text-left text-xs hover:bg-secondary/40"
          onClick={() => copyValue(projectPath, "Project path copied")}
        >
          <code className="min-w-0 flex-1 break-all">{projectPath}</code>
          <Copy className="h-3.5 w-3.5 shrink-0" />
        </button>
      </div>

      <details className="rounded-lg border border-border/40 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">Use URL and password instead</summary>
        <div className="grid gap-3 pt-3">
          <p>
            Use this backup if pairing is unavailable. The password stays valid until it is changed.
          </p>
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 rounded-md bg-secondary/30 px-3 py-2 text-left"
            onClick={() => copyValue(url, "Server URL copied")}
          >
            <code className="min-w-0 flex-1 break-all">{url}</code>
            <Copy className="h-3.5 w-3.5 shrink-0" />
          </button>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !hasCredential}
              onClick={() => copyPassword(false)}
            >
              Copy password
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !hasCredential}
              onClick={() => copyPassword(true)}
            >
              Copy password attach
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}
