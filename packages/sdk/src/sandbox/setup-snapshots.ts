import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SandboxIdentity } from "./backend.js";
import { defaultStoreDirectory } from "./store.js";

/**
 * A setup snapshot is a provider snapshot of a sandbox taken after setup work (dependencies,
 * toolchains, services), so new sandboxes start ready instead of redoing it. An account can
 * keep several; each may be tied to the checkout it was made for. Records live locally next
 * to the sandbox records and never hold credentials.
 */
export type SetupSnapshotRecord = SandboxIdentity & {
  /** The provider's snapshot id; new sandboxes start from it. */
  snapshotId: string;
  /** A short label, e.g. "deps" or "deps + postgres". */
  label: string;
  /** The checkout it was made for, or null when it serves any project. */
  project: string | null;
  /** What the sandbox has set up, in the agent's own words. */
  note: string;
  /** Hashes of the checkout's dependency files when saved; a change means it is out of date. */
  fingerprint: Record<string, string>;
  sandboxId: string;
  createdAt: string;
};

export type SetupSnapshotStatus = {
  record: SetupSnapshotRecord;
  /** Dependency files added, changed, or removed since; empty for untied snapshots. */
  changed: string[];
};

/** Files whose change means the installed dependencies or toolchain differ. Root only. */
const SETUP_FILES = [
  "package.json",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".nvmrc",
  ".node-version",
  ".tool-versions",
  ".python-version",
  "requirements.txt",
  "requirements-dev.txt",
  "pyproject.toml",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "Cargo.lock",
  "go.sum",
  "Gemfile.lock",
  "composer.lock",
  "mix.lock",
  "pubspec.lock",
  "Dockerfile",
  "docker-compose.yml",
  "compose.yaml",
];

/** Hashes of the setup files present at the checkout root. */
export async function setupFingerprint(project: string): Promise<Record<string, string>> {
  const entries = await Promise.all(
    SETUP_FILES.map(async (file) => {
      const data = await readFile(path.join(project, file)).catch(() => null);
      return data ? [file, createHash("sha256").update(data).digest("hex").slice(0, 16)] : null;
    }),
  );
  return Object.fromEntries(entries.filter((entry): entry is [string, string] => entry !== null));
}

export function changedSetupFiles(
  saved: Record<string, string>,
  current: Record<string, string>,
): string[] {
  return [...new Set([...Object.keys(saved), ...Object.keys(current)])]
    .filter((file) => saved[file] !== current[file])
    .toSorted();
}

/** A provider-safe snapshot name that says what it is and, if tied, which checkout. */
export function setupSnapshotName(label: string, project: string | null): string {
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24);
  const scope = project
    ? `${slug(path.basename(project)) || "project"}-${createHash("sha256").update(project).digest("hex").slice(0, 8)}`
    : "shared";
  return `gitterm-setup-${scope}-${slug(label) || "setup"}-${Date.now().toString(36)}`;
}

export interface SetupSnapshotStore {
  /** This account's snapshots, newest first. */
  list(identity: SandboxIdentity): Promise<SetupSnapshotRecord[]>;
  put(record: SetupSnapshotRecord): Promise<void>;
  remove(identity: SandboxIdentity, snapshotId: string): Promise<void>;
}

export function createFileSetupSnapshotStore(
  directory = path.join(defaultStoreDirectory(), "setup-snapshots"),
): SetupSnapshotStore {
  const prefix = (identity: SandboxIdentity) =>
    `${identity.mode}-${identity.provider}-${identity.account}-`.replace(/[^A-Za-z0-9_.-]/g, "_");
  const file = (identity: SandboxIdentity, snapshotId: string) =>
    path.join(
      directory,
      `${prefix(identity)}${createHash("sha256").update(snapshotId).digest("hex").slice(0, 16)}.json`,
    );
  return {
    async list(identity) {
      const names = (await readdir(directory).catch(() => [] as string[])).filter(
        (name) => name.startsWith(prefix(identity)) && name.endsWith(".json"),
      );
      const records = await Promise.all(
        names.map((name) =>
          readFile(path.join(directory, name), "utf8")
            .then((text) => JSON.parse(text) as SetupSnapshotRecord)
            .catch(() => null),
        ),
      );
      return records
        .filter((record): record is SetupSnapshotRecord => record !== null)
        .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async put(record) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(file(record, record.snapshotId), JSON.stringify(record, null, 2), {
        mode: 0o600,
      });
    },
    async remove(identity, snapshotId) {
      await rm(file(identity, snapshotId), { force: true });
    },
  };
}
