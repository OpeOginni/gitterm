import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** A session moved to the cloud: what is needed to bring it back. */
export type MoveRecord = {
  workspaceId: string;
  /** The adapter's key: which agent the session belongs to. */
  agent: string;
  /** The local session, its size when copied, and the checkout it ran in. */
  localRef: string;
  localMark: number;
  localCwd: string;
  root: string;
  head: string;
  /** Digest of the checkout's state when it moved, to tell whether it changed here since. */
  state: string;
  cloudRef: string;
  cloudCwd: string;
  cloudDirectory: string;
  /** The adapter's `connect` state, for `disconnect`. */
  connection?: Record<string, string>;
  movedAt: string;
  returnedAt?: string;
};

// One file per record, so moves and returns of different sessions never write the same file.
// `process.env.HOME` first: Bun's homedir() ignores a HOME changed at runtime (tests do).
const recordsDir = () => path.join(process.env.HOME || homedir(), ".config", "gitterm", "moves");

export async function loadRecords(): Promise<MoveRecord[]> {
  const names = await readdir(recordsDir()).catch(() => []);
  const records = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map((name) =>
        readFile(path.join(recordsDir(), name), "utf8")
          .then((text) => JSON.parse(text) as MoveRecord)
          .catch(() => undefined),
      ),
  );
  return records
    .filter((record) => record !== undefined)
    .sort((a, b) => a.movedAt.localeCompare(b.movedAt));
}

export async function saveRecord(record: MoveRecord) {
  const file = path.join(recordsDir(), `${encodeURIComponent(record.workspaceId)}.json`);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(recordsDir(), { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}
