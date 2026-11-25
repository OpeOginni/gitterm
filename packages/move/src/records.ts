import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type MoveRecord = {
  workspaceId: string;
  agent: string;
  localRef: string;
  localMark: number;
  localCwd: string;
  root: string;
  head: string;
  /** Checkout digest at the time of the move. */
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

/** Whether a process with this id runs (one of another user's counts). */
const alive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Keep dead claims so concurrent recovery attempts contend for the same next number. */
export async function claimMove(agent: string, ref: string): Promise<() => Promise<void>> {
  const key = encodeURIComponent(`${agent}:${ref}`);
  const claim = (n: number) => path.join(recordsDir(), `${key}.${n}.lock`);
  const busy = () =>
    new Error("This session is already moving to the cloud. Wait for that move to finish.");
  await mkdir(recordsDir(), { recursive: true, mode: 0o700 });
  // Written whole, then linked: a claim is never seen without its process id.
  const temporary = path.join(recordsDir(), `${key}.${randomUUID()}.tmp`);
  await writeFile(temporary, String(process.pid), { mode: 0o600 });
  try {
    for (;;) {
      const numbers = (await readdir(recordsDir())).flatMap((name) => {
        const match =
          name.startsWith(`${key}.`) && /^(\d+)\.lock$/.exec(name.slice(key.length + 1));
        return match ? [Number(match[1])] : [];
      });
      const last = numbers.length ? Math.max(...numbers) : -1;
      if (last >= 0) {
        const holder = await readFile(claim(last), "utf8").catch(() => undefined);
        // Released while listing: look again, or the next claim could land below a new one.
        if (holder === undefined) continue;
        if (alive(Number(holder))) throw busy();
      }
      try {
        await link(temporary, claim(last + 1));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw busy();
        throw error;
      }
      const mine = claim(last + 1);
      return () => rm(mine, { force: true });
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
