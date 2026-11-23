import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

// `process.env.HOME` first: Bun's homedir() ignores a HOME changed at runtime (tests do).
const recordsFile = () =>
  path.join(process.env.HOME || homedir(), ".config", "gitterm", "moves.json");

export async function loadRecords(): Promise<MoveRecord[]> {
  try {
    return JSON.parse(await readFile(recordsFile(), "utf8")) as MoveRecord[];
  } catch {
    return [];
  }
}

export async function saveRecord(record: MoveRecord) {
  const records = (await loadRecords()).filter((item) => item.workspaceId !== record.workspaceId);
  records.push(record);
  await mkdir(path.dirname(recordsFile()), { recursive: true, mode: 0o700 });
  await writeFile(`${recordsFile()}.tmp`, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
  await rename(`${recordsFile()}.tmp`, recordsFile());
}
