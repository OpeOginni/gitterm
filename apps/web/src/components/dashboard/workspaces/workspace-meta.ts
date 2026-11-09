import type { trpc } from "@/utils/trpc";
import type { Tone } from "@/components/dashboard/kit";

export type Workspace = NonNullable<
  (typeof trpc.workspace.listWorkspaces)["~types"]["output"]
>["workspaces"][number];
export type CloudProvider =
  (typeof trpc.workspace.listCloudProviders)["~types"]["output"]["cloudProviders"][number];

export const PROVIDER_LOGOS: Record<string, string> = {
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

/** Sandboxes come from the sandbox API and plugins; everything else runs a coding agent. */
export const isSandbox = (workspace: Workspace) => workspace.image.agentType.key === "sandbox";

/** Pending workspaces are on their way to running, so filters and costs count them as running. */
export const isLive = (workspace: Workspace) =>
  workspace.status === "running" || workspace.status === "pending";

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  running: { label: "Running", tone: "ok" },
  pending: { label: "Starting", tone: "busy" },
  paused: { label: "Paused", tone: "muted" },
  terminated: { label: "Terminated", tone: "danger" },
};

/** "acme/shop" from a git URL. */
export function repoName(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\/(github|gitlab)\.com\//i, "").replace(/\.git$/i, "");
}

/** The repository's page on its host, at the workspace's branch. */
export function repoHref(workspace: Workspace): string | null {
  if (!workspace.repositoryUrl) return null;
  const base = workspace.repositoryUrl.replace(/\.git$/i, "");
  if (!/^https?:\/\//i.test(base)) return null;
  const branch = workspace.repositoryBranch;
  return branch ? `${base}/tree/${encodeURIComponent(branch)}` : base;
}

/** The size this workspace runs on, with its hourly price when billing prices it. */
export function machineProfileOf(workspace: Workspace, provider: CloudProvider | undefined) {
  return provider?.machineProfiles.find((profile) => profile.id === workspace.machineProfileId);
}

/** Lowercased text a search matches against. */
export function searchText(workspace: Workspace): string {
  return [
    workspace.name,
    workspace.subdomain,
    workspace.repositoryUrl,
    workspace.repositoryBranch,
    workspace.image.agentType.name,
    workspace.cloudProvider?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
