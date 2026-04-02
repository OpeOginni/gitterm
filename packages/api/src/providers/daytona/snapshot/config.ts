export const DAYTONA_SNAPSHOT_REGIONS = ["eu"] as const;

export type DaytonaSnapshotRegion = (typeof DAYTONA_SNAPSHOT_REGIONS)[number];
export type DaytonaSnapshotKind = "server" | "server-ssh";

const DAYTONA_SNAPSHOT_BASE_NAMES: Record<DaytonaSnapshotKind, string> = {
  server: "gitterm/opencode-server",
  "server-ssh": "gitterm/opencode-server-ssh",
};

export const DAYTONA_SNAPSHOT_RESOURCES: Record<
  DaytonaSnapshotKind,
  { cpu: number; memory: number }
> = {
  server: {
    cpu: 2,
    memory: 4,
  },
  "server-ssh": {
    cpu: 4,
    memory: 6,
  },
};

export function getDaytonaSnapshotName(
  kind: DaytonaSnapshotKind,
): string {
  return `${DAYTONA_SNAPSHOT_BASE_NAMES[kind]}`;
}

export function getDaytonaRegionSnapshots(kind: DaytonaSnapshotKind): Record<string, string> {
  return Object.fromEntries(
    DAYTONA_SNAPSHOT_REGIONS.map((region) => [region, getDaytonaSnapshotName(kind)]),
  );
}
