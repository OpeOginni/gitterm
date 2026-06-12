// Only `eu` is enabled because the Daytona org currently has runner capacity in
// eu only. Add more regions here once the account has runners there (otherwise
// snapshot builds and sandbox creation fail with "No available runners").
export const DAYTONA_SNAPSHOT_REGIONS = ["eu"] as const;

export type DaytonaSnapshotRegion = (typeof DAYTONA_SNAPSHOT_REGIONS)[number];
// Two snapshot kinds. SSH access itself is provided by Daytona's platform-level
// SSH gateway (see getWorkspaceSSHAccess in ../index.ts), so `server-ssh` uses
// the SAME base image as `server` - it exists only to give editor/SSH
// workspaces a larger resource allocation (Daytona snapshot creation from a
// snapshot has no per-sandbox resource override).
export type DaytonaSnapshotKind = "server" | "server-ssh";

// Docker images that back each snapshot kind. These are the same images that
// power the AWS/Cloudflare providers, so Daytona snapshots stay in lockstep
// with the rest of the platform instead of maintaining a parallel inline build.
export const DAYTONA_SNAPSHOT_BASE_IMAGES: Record<DaytonaSnapshotKind, string> = {
  server: "opeoginni/gitterm-opencode-server:latest",
  "server-ssh": "opeoginni/gitterm-opencode-server:latest",
};

const DAYTONA_SNAPSHOT_BASE_NAMES: Record<DaytonaSnapshotKind, string> = {
  server: "gitterm-opencode-server",
  "server-ssh": "gitterm-opencode-server-ssh",
};

export const DAYTONA_SNAPSHOT_RESOURCES: Record<
  DaytonaSnapshotKind,
  { cpu: number; memory: number }
> = {
  server: {
    cpu: 2,
    memory: 4,
  },
  // Editor/SSH workspaces get more headroom for IDE servers + tooling.
  "server-ssh": {
    cpu: 4,
    memory: 8,
  },
};

function isKnownRegion(region: string): region is DaytonaSnapshotRegion {
  return (DAYTONA_SNAPSHOT_REGIONS as readonly string[]).includes(region);
}

// Snapshots are scoped per-region in Daytona, so we suffix the name with the
// region to keep them unique within the organization (e.g.
// `gitterm-opencode-server-eu`, `gitterm-opencode-server-us`).
export function getDaytonaSnapshotName(
  kind: DaytonaSnapshotKind,
  region: DaytonaSnapshotRegion,
): string {
  return `${DAYTONA_SNAPSHOT_BASE_NAMES[kind]}-${region}`;
}

export function resolveDaytonaSnapshotName(
  kind: DaytonaSnapshotKind,
  region: string,
): string {
  const resolvedRegion = isKnownRegion(region)
    ? region
    : DAYTONA_SNAPSHOT_REGIONS[0];
  return getDaytonaSnapshotName(kind, resolvedRegion);
}

export function getDaytonaRegionSnapshots(
  kind: DaytonaSnapshotKind,
): Record<DaytonaSnapshotRegion, string> {
  return Object.fromEntries(
    DAYTONA_SNAPSHOT_REGIONS.map((region) => [
      region,
      getDaytonaSnapshotName(kind, region),
    ]),
  ) as Record<DaytonaSnapshotRegion, string>;
}
