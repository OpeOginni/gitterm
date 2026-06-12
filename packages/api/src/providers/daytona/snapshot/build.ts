import { Daytona, Image } from "@daytonaio/sdk";
import {
  DAYTONA_SNAPSHOT_BASE_IMAGES,
  DAYTONA_SNAPSHOT_REGIONS,
  DAYTONA_SNAPSHOT_RESOURCES,
  getDaytonaSnapshotName,
  type DaytonaSnapshotKind,
  type DaytonaSnapshotRegion,
} from "./config";
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

function createSnapshotImage(kind: DaytonaSnapshotKind) {
  return Image.base(DAYTONA_SNAPSHOT_BASE_IMAGES[kind]);
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
    console.log(
      `[daytona-snapshot] deleting existing snapshot ${snapshotName}`,
    );
    await daytona.snapshot.delete(snapshot);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

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

  await deleteSnapshotIfExists(daytona, snapshotName);

  await Bun.sleep(60_000);
  console.log("[daytona-snapshot] waited for 60000ms");

  console.log(
    `[daytona-snapshot] creating ${snapshotName} kind=${definition.kind} region=${region} base=${DAYTONA_SNAPSHOT_BASE_IMAGES[definition.kind]}`,
  );

  await daytona.snapshot.create({
    name: snapshotName,
    regionId: region,
    image: createSnapshotImage(definition.kind),
    entrypoint: ["sleep", "infinity"],
    resources: DAYTONA_SNAPSHOT_RESOURCES[definition.kind],
  });
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
