import { Daytona, Image } from "@daytonaio/sdk";
import {
  DAYTONA_SNAPSHOT_REGIONS,
  DAYTONA_SNAPSHOT_RESOURCES,
  getDaytonaSnapshotName,
  type DaytonaSnapshotKind,
  type DaytonaSnapshotRegion,
} from "./config";
import { getLatestOpencodeVersion } from "../../opencode-version";
import "dotenv/config";

const snapshotDefinitions: Array<{
  kind: DaytonaSnapshotKind;
}> = [
  {
    kind: "server",
  },
  {
    kind: "server-ssh",
  },
];

function createBaseImage(opencodeVersion: string) {
  return Image.base("node:20-bookworm-slim")
    .dockerfileCommands([
      "RUN apt-get update && apt-get install -y --no-install-recommends git bash curl ca-certificates && rm -rf /var/lib/apt/lists/*",
      `RUN curl -fsSL https://opencode.ai/install | HOME=/workspace VERSION=${opencodeVersion} bash && ln -sf /workspace/.opencode/bin/opencode /usr/local/bin/opencode && /usr/local/bin/opencode --version`,
      "RUN curl -fsSL https://get.docker.com | sh -",
    ])
    .workdir("/workspace")
    .env({
      HOME: "/workspace",
      XDG_CONFIG_HOME: "/workspace/.config",
      XDG_DATA_HOME: "/workspace/.local/share",
      XDG_STATE_HOME: "/workspace/.local/state",
      XDG_CACHE_HOME: "/workspace/.cache",
      NPM_CONFIG_USERCONFIG: "/workspace/.npmrc",
      NPM_CONFIG_CACHE: "/workspace/.npm",
      PATH: "/workspace/.opencode/bin:/workspace/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      OPENCODE_CONFIG_DIR: "/workspace/.config/opencode",
      OPENCODE_DATA_DIR: "/workspace/.local/share/opencode",
      OPENCODE_CACHE_DIR: "/workspace/.cache/opencode",
      HISTFILE: "/workspace/.bash_history",
    });
}

function createSnapshotImage(_kind: DaytonaSnapshotKind, opencodeVersion: string) {
  return createBaseImage(opencodeVersion);
}

function getApiKey(): string {
  const apiKey = process.env.DAYTONA_API_KEY;

  if (!apiKey) {
    throw new Error("DAYTONA_API_KEY is required to build Daytona snapshots.");
  }

  return apiKey;
}

async function deleteSnapshotIfExists(daytona: Daytona, snapshotName: string) {
  try {
    const snapshot = await daytona.snapshot.get(snapshotName);
    console.log(`[daytona-snapshot] deleting existing snapshot ${snapshotName}`);
    await daytona.snapshot.delete(snapshot);
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (message.includes("not found")) {
      return;
    }

    throw error;
  }
}

async function buildSnapshot(
  apiKey: string,
  definition: (typeof snapshotDefinitions)[number],
  region: DaytonaSnapshotRegion,
  opencodeVersion: string,
) {
  const snapshotName = getDaytonaSnapshotName(definition.kind);
  const daytona = new Daytona({ apiKey, target: region });

  await deleteSnapshotIfExists(daytona, snapshotName);

  await Bun.sleep(10_000);
  console.log("[daytona-snapshot] waited for 10000ms");

  console.log(
    `[daytona-snapshot] creating ${snapshotName} kind=${definition.kind} region=${region}`,
  );

  await daytona.snapshot.create({
    name: snapshotName,
    regionId: region,
    image: createSnapshotImage(definition.kind, opencodeVersion),
    entrypoint: ["sleep", "infinity"],
    resources: DAYTONA_SNAPSHOT_RESOURCES[definition.kind],
  });
}

async function main() {
  const apiKey = getApiKey();
  const opencodeVersion = await getLatestOpencodeVersion();
  console.log(`[daytona-snapshot] pinning opencode version ${opencodeVersion}`);

  for (const region of DAYTONA_SNAPSHOT_REGIONS) {
    for (const definition of snapshotDefinitions) {
      await buildSnapshot(apiKey, definition, region, opencodeVersion);
    }
  }

  console.log("[daytona-snapshot] built snapshots");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
