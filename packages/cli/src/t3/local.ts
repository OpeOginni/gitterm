import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** This machine's T3 Code: its data directory and CLI, as the T3 script finds them. */
export function t3BaseDir(): string {
  return process.env.T3CODE_HOME || path.join(homedir(), ".t3");
}

export function t3Binary(): string {
  const candidates = [process.env.T3CODE_CLI_PATH];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter))
    if (dir) candidates.push(path.join(dir, "t3"));
  candidates.push(path.join(homedir(), ".t3", "bin", "t3"));
  for (const candidate of candidates) {
    try {
      if (candidate && statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {
      /* Not this one. */
    }
  }
  throw new Error("T3 Code's t3 command was not found. Install T3 Code, or set T3CODE_CLI_PATH.");
}

function t3(args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      t3Binary(),
      [...args, "--base-dir", t3BaseDir()],
      { encoding: "utf8", timeout: 180_000, maxBuffer: 16 << 20 },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const detail = `${stderr}\n${stdout}`
          .split("\n")
          .find((line) => /error/i.test(line) && !/electron|CompileAndCall/.test(line));
        reject(
          new Error(`t3 ${args.slice(0, 2).join(" ")} failed${detail ? `: ${detail.trim()}` : ""}`),
        );
      },
    ),
  );
}

export type LinkedEnvironment = {
  environmentId: string;
  label: string;
  urls: string[];
  status: string;
};

export async function linkedEnvironments(): Promise<LinkedEnvironment[]> {
  return JSON.parse(await t3(["environment", "list", "--json"])) as LinkedEnvironment[];
}

/** Links the environment at url to this machine's T3 Code, so its agents can work there. */
export async function linkEnvironment(url: string, pairingCode: string, access: string) {
  await t3(["environment", "link", url, "--pairing-code", pairingCode, "--access", access]);
  const origin = new URL(url).origin;
  const linked = (await linkedEnvironments()).find((environment) =>
    environment.urls.some((item) => URL.canParse(item) && new URL(item).origin === origin),
  );
  if (!linked) throw new Error(`Linked ${url}, but T3 Code does not list it`);
  return linked;
}

export async function unlinkEnvironment(environmentId: string) {
  await t3(["environment", "unlink", environmentId]);
}

/** A thread link T3 Code renders as a chip and opens, through a link when it is elsewhere. */
export const threadLink = (environmentId: string, threadId: string) =>
  `t3-thread://v2/${environmentId}/${encodeURIComponent(threadId)}`;

/** A thread moved to the cloud: what is needed to bring it back. */
export type MoveRecord = {
  workspaceId: string;
  /** The local thread, its Claude session and checkout when it moved. */
  localThreadId: string;
  localSessionId: string;
  /** Size of the local session file that was copied; anything after it was written here later. */
  localSessionBytes: number;
  localCwd: string;
  root: string;
  head: string;
  /** Digest of the checkout's state when it moved, to tell whether it changed here since. */
  state: string;
  cloudThreadId: string;
  cloudSessionId: string;
  cloudCwd: string;
  cloudDirectory: string;
  environmentId?: string;
  linkedEnvironmentId?: string;
  movedAt: string;
  returnedAt?: string;
};

const recordsFile = () =>
  path.join(process.env.HOME || homedir(), ".config", "gitterm", "t3-cloud.json");

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
