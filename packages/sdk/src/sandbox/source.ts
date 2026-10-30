import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import type { SandboxBackend } from "./backend.js";
import { createTarGz, type TarEntry } from "./tar.js";

/**
 * Source snapshots for sandbox builds: the working tree exactly as it is on disk
 * (committed, staged, unstaged, and non-ignored untracked files; deleted files absent),
 * without Git history or the conversation. Secret-looking files are excluded.
 */

/** The synced checkout and Gitterm bookkeeping live below the sandbox user's home. */
export const projectDir = (home: string) => `${home}/project`;
const stateDir = (home: string) => `${home}/.gitterm/source`;
export const MAX_SOURCE_BYTES = 100 * 1024 * 1024;

export type SnapshotFile = {
  path: string;
  kind: "file" | "executable" | "symlink";
  size: number;
  /** sha256 of the content, or of the link target for symlinks. */
  sha256: string;
};

export type SourceSnapshot = {
  id: string;
  /** sha256 over the sorted manifest. Identifies exactly what runs remotely. */
  digest: string;
  root: string;
  head: string | null;
  files: SnapshotFile[];
  /** Tracked files deleted in the working tree; they are absent from the snapshot. */
  deleted: string[];
  /** Tracked files with uncommitted changes. */
  modified: string[];
  /** Non-ignored untracked files included in the snapshot. */
  untracked: string[];
  excluded: Array<{ path: string; reason: string }>;
  bytes: number;
};

export type CapturedSource = { snapshot: SourceSnapshot; archive: Buffer };

function git(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "core.quotePath=false", ...args],
      {
        cwd,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60_000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout) =>
        // Git errors can echo file contents or credential-bearing URLs.
        error ? reject(new Error(`git ${args[0]} failed in the source checkout`)) : resolve(stdout),
    );
  });
}

const nulList = (buffer: Buffer) => buffer.toString("utf8").split("\0").filter(Boolean);

export function safeRelativePath(file: string): boolean {
  return (
    Boolean(file) &&
    !["\\", "\0", "\n", "\r"].some((character) => file.includes(character)) &&
    !path.posix.isAbsolute(file) &&
    file
      .split("/")
      .every(
        (part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git",
      )
  );
}

export function sensitivePath(file: string): boolean {
  return /(^|\/)(\.env($|\.(?!example$|sample$|template$))|\.npmrc$|\.netrc$|\.pypirc$|id_(rsa|ed25519|ecdsa)($|\.)|credentials(?:\.json)?$)|\.(pem|p12|pfx|key)$/i.test(
    file,
  );
}

const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;

/** `*` stays within a path segment, `**` crosses segments. A pattern without `/` matches any basename. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replaceAll("\0", ".*");
  return new RegExp(glob.includes("/") ? `^${escaped}$` : `(^|/)${escaped}$`);
}

export async function captureSource(
  directory: string,
  options: { exclude?: string[]; maxBytes?: number } = {},
): Promise<CapturedSource> {
  let root: string;
  try {
    root = await realpath(
      (await git(directory, ["rev-parse", "--show-toplevel"])).toString().trim(),
    );
  } catch {
    throw new Error("Sandbox sync needs a Git checkout so ignored files can be excluded.");
  }
  if ((await git(root, ["ls-files", "--unmerged", "-z"])).length)
    throw new Error("Resolve merge conflicts before syncing to a sandbox.");
  const staged = (await git(root, ["ls-files", "--stage", "-z"])).toString().split("\0");
  if (staged.some((line) => line.startsWith("160000 ")))
    throw new Error("Submodules are not supported by sandbox sync yet.");
  const head = await git(root, ["rev-parse", "--verify", "-q", "HEAD"])
    .then((value) => value.toString().trim())
    .catch(() => null);

  const tracked = nulList(await git(root, ["ls-files", "-z", "--cached"]));
  const deleted = new Set(nulList(await git(root, ["ls-files", "-z", "--deleted"])));
  const modified = nulList(await git(root, ["ls-files", "-z", "--modified"])).filter(
    (file) => !deleted.has(file),
  );
  const untracked = nulList(await git(root, ["ls-files", "-z", "--others", "--exclude-standard"]));
  const exclude = (options.exclude ?? []).map(globToRegExp);
  const maxBytes = options.maxBytes ?? MAX_SOURCE_BYTES;

  const candidates = [...new Set([...tracked.filter((file) => !deleted.has(file)), ...untracked])]
    // Byte order matches `LC_ALL=C sort` in the sandbox.
    .toSorted((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const files: SnapshotFile[] = [];
  const entries: TarEntry[] = [];
  const excluded: SourceSnapshot["excluded"] = [];
  let bytes = 0;
  for (const file of candidates) {
    if (!safeRelativePath(file)) {
      excluded.push({ path: file, reason: "unsupported path" });
      continue;
    }
    if (sensitivePath(file)) {
      excluded.push({ path: file, reason: "secret-like file name" });
      continue;
    }
    if (exclude.some((pattern) => pattern.test(file))) {
      excluded.push({ path: file, reason: "excluded by configuration" });
      continue;
    }
    const full = path.join(root, file);
    const info = await lstat(full).catch(() => null);
    if (!info) continue;
    if (info.isSymbolicLink()) {
      const target = await readlink(full);
      files.push({
        path: file,
        kind: "symlink",
        size: 0,
        sha256: createHash("sha256").update(target).digest("hex"),
      });
      entries.push({ path: file, type: "symlink", target });
      continue;
    }
    if (!info.isFile()) {
      excluded.push({ path: file, reason: "not a regular file" });
      continue;
    }
    bytes += info.size;
    if (bytes > maxBytes)
      throw new Error(
        `Source exceeds the ${Math.round(maxBytes / 1024 / 1024)} MiB sandbox sync limit. Exclude build output or large files.`,
      );
    // Hash and archive the same bytes so the manifest describes exactly what is uploaded.
    const data = await readFile(full);
    if (PRIVATE_KEY.test(data.subarray(0, 4 * 1024 * 1024).toString("latin1"))) {
      excluded.push({ path: file, reason: "contains private key material" });
      bytes -= info.size;
      continue;
    }
    const executable = Boolean(info.mode & 0o111);
    files.push({
      path: file,
      kind: executable ? "executable" : "file",
      size: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
    entries.push({ path: file, type: "file", data, executable });
  }

  const digest = createHash("sha256").update(manifestText(files)).digest("hex");
  const included = new Set(files.map((file) => file.path));
  return {
    snapshot: {
      id: `snap_${digest.slice(0, 16)}`,
      digest,
      root,
      head,
      files,
      deleted: [...deleted].toSorted(),
      modified: modified.filter((file) => included.has(file)),
      untracked: untracked.filter((file) => included.has(file)),
      excluded,
      bytes,
    },
    archive: createTarGz(entries),
  };
}

function manifestText(files: SnapshotFile[]): string {
  return files.map((file) => `${file.kind} ${file.sha256} ${file.path}\n`).join("");
}

const q = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

/**
 * Makes the sandbox project directory match the snapshot: files from the previous
 * snapshot that are absent now are deleted, every snapshot file is written, and each
 * regular file is checked against its sha256 before success is reported. Ignored build
 * output (e.g. node_modules) that was never part of a snapshot is left in place.
 */
export async function uploadSource(
  backend: SandboxBackend,
  sandboxId: string,
  captured: CapturedSource,
): Promise<{ verified: true; digest: string }> {
  const { snapshot, archive } = captured;
  const STATE_DIR = stateDir(backend.home);
  const PROJECT_DIR = projectDir(backend.home);
  const base = `${STATE_DIR}/${snapshot.id}`;
  const list = snapshot.files.map((file) => `${file.path}\n`).join("");
  const sums = snapshot.files
    .filter((file) => file.kind !== "symlink")
    .map((file) => `${file.sha256}  ${file.path}\n`)
    .join("");
  const prepared = await backend.run(sandboxId, `mkdir -p ${q(STATE_DIR)} ${q(PROJECT_DIR)}`);
  if (prepared.exitCode !== 0) throw new Error("Could not prepare the sandbox for upload");
  await backend.writeFile(sandboxId, `${base}.tgz`, archive);
  await backend.writeFile(sandboxId, `${base}.files`, Buffer.from(list));
  await backend.writeFile(sandboxId, `${base}.sha256`, Buffer.from(sums));
  const result = await backend.run(
    sandboxId,
    [
      "set -eu",
      "export LC_ALL=C",
      `B=${q(base)}; P=${q(PROJECT_DIR)}; S=${q(STATE_DIR)}`,
      'rm -rf "$B.stage"; mkdir -p "$B.stage"',
      'tar -xzf "$B.tgz" -C "$B.stage" --no-same-owner',
      'for f in "$B.stage"/gitterm-pax/*; do [ -e "$f" ] || break; echo "unexpected pax placeholder" >&2; exit 4; done',
      '(cd "$B.stage" && sha256sum -c --quiet --strict "$B.sha256") || { echo "staged files failed verification" >&2; exit 5; }',
      'sort -o "$B.files" "$B.files"',
      'if [ -f "$S/current.files" ]; then comm -23 "$S/current.files" "$B.files" | while IFS= read -r f; do rm -f -- "$P/$f"; done; fi',
      'cp -a "$B.stage/." "$P/"',
      '(cd "$P" && sha256sum -c --quiet --strict "$B.sha256") || { echo "project files failed verification" >&2; exit 6; }',
      'mv "$B.files" "$S/current.files"',
      `printf %s ${q(snapshot.digest)} > "$S/current.digest"`,
      'rm -rf "$B.stage" "$B.tgz" "$B.sha256"',
      "echo GITTERM_SOURCE_VERIFIED",
    ].join("\n"),
    { timeoutMs: 120_000 },
  );
  if (result.exitCode !== 0 || !result.stdout.includes("GITTERM_SOURCE_VERIFIED"))
    throw new Error(
      `Source upload failed verification in the sandbox (exit ${result.exitCode}). ${result.stderr.trim().slice(-300)}`,
    );
  return { verified: true, digest: snapshot.digest };
}
