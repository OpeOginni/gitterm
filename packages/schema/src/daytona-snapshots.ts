export const DAYTONA_SNAPSHOT_REGIONS = ["eu"] as const;

export type DaytonaSnapshotRegion = (typeof DAYTONA_SNAPSHOT_REGIONS)[number];
export type DaytonaSnapshotKind = "server" | "server-with-ssh";

const DAYTONA_SNAPSHOT_BASE_NAMES: Record<DaytonaSnapshotKind, string> = {
  server: "gitterm/opencode-server-daytona",
  "server-with-ssh": "gitterm/opencode-server-with-ssh-daytona",
};

export const DAYTONA_SNAPSHOT_RESOURCES = {
  cpu: 2,
  memory: 4,
  disk: 4,
} as const;

export function getDaytonaSnapshotName(
  kind: DaytonaSnapshotKind,
  region: DaytonaSnapshotRegion,
): string {
  return `${DAYTONA_SNAPSHOT_BASE_NAMES[kind]}-${region}`;
}

export function getDaytonaRegionSnapshots(kind: DaytonaSnapshotKind): Record<string, string> {
  return Object.fromEntries(
    DAYTONA_SNAPSHOT_REGIONS.map((region) => [region, getDaytonaSnapshotName(kind, region)]),
  );
}
