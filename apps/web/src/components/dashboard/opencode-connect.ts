import { toast } from "sonner";
import { opencodeAttachCommand } from "@/lib/opencode-connection";
import { trpcClient } from "@/utils/trpc";

// Each call issues its own single-use code; never reuse a link consumed by another client.
// Use the client directly so secrets are not retained in React Query's mutation cache.
function createConnection(workspaceId: string, kind: "link" | "tui") {
  return trpcClient.workspace.createOpencodeConnection.mutate({ workspaceId, kind });
}

/** Copy a pairing link for the OpenCode desktop app's Connect server dialog. */
export async function copyOpencodePairingLink(workspaceId: string) {
  try {
    const result = await createConnection(workspaceId, "link");
    if (result.kind !== "link") throw new Error("Could not create a pairing link");
    await navigator.clipboard.writeText(result.link);
    toast.success("Pairing link copied", {
      description:
        "In the OpenCode desktop app, choose Connect server and paste it. Works once, within 5 minutes.",
    });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not create a pairing link");
  }
}

/** Build an attach command that carries a paired session token instead of the server password. */
export async function opencodeSessionAttachCommand(workspaceId: string) {
  const result = await createConnection(workspaceId, "tui");
  if (result.kind !== "tui") throw new Error("Could not create a session token");
  return opencodeAttachCommand(result.url, result.token);
}

/**
 * Open the workspace's own OpenCode web UI already signed in. Browsers that open a pairing
 * link get a session cookie and a redirect to the UI, so the password never leaves GitTerm.
 */
export async function openOpencodeInBrowser(workspaceId: string, url: string) {
  // Open the tab before awaiting so popup blockers treat it as part of the click.
  const tab = window.open("", "_blank");
  if (!tab) return toast.error("Allow pop-ups to open OpenCode");
  tab.opener = null;
  try {
    const result = await createConnection(workspaceId, "link");
    tab.location.href = result.kind === "link" ? result.link : url;
  } catch {
    tab.location.href = url;
    toast.info("Sign in with the server password");
  }
}
