import { Daytona, Image } from "@daytonaio/sdk";
import {
  DAYTONA_SNAPSHOT_REGIONS,
  DAYTONA_SNAPSHOT_RESOURCES,
  getDaytonaSnapshotName,
  type DaytonaSnapshotKind,
  type DaytonaSnapshotRegion,
} from "@gitterm/schema/daytona-snapshots";
import "dotenv/config";

const snapshotDefinitions: Array<{
  kind: DaytonaSnapshotKind;
}> = [
  {
    kind: "server",
  },
  {
    kind: "server-with-ssh",
  },
];

function createBaseImage() {
  return Image.base("oven/bun:1-slim")
    .dockerfileCommands([
      "RUN apt-get update && apt-get install -y --no-install-recommends git bash curl ca-certificates && rm -rf /var/lib/apt/lists/*",
      "RUN mkdir -p /opt/bun && BUN_INSTALL=/opt/bun bun add -g opencode-ai@latest",
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
      BUN_INSTALL: "/opt/bun",
      PATH: "/opt/bun/bin:/opt/bun/install/global/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      OPENCODE_CONFIG_DIR: "/workspace/.config/opencode",
      OPENCODE_DATA_DIR: "/workspace/.local/share/opencode",
      OPENCODE_CACHE_DIR: "/workspace/.cache/opencode",
      HISTFILE: "/workspace/.bash_history",
    });
}

function createSnapshotImage(_kind: DaytonaSnapshotKind) {
  return createBaseImage();
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
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

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
) {
  const snapshotName = getDaytonaSnapshotName(definition.kind, region);
  const daytona = new Daytona({ apiKey, target: region });

  // await deleteSnapshotIfExists(daytona, snapshotName);

  console.log(`[daytona-snapshot] creating ${snapshotName} kind=${definition.kind} region=${region}`);

  await daytona.snapshot.create(
    {
      name: snapshotName,
      regionId: region,
      image: createSnapshotImage(definition.kind),
      entrypoint: ["sleep", "infinity"],
      resources: DAYTONA_SNAPSHOT_RESOURCES,
    },
  );
}

async function main() {
  const apiKey = getApiKey();

  for (const region of DAYTONA_SNAPSHOT_REGIONS) {
    for (const definition of snapshotDefinitions) {
      await buildSnapshot(apiKey, definition, region);
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
