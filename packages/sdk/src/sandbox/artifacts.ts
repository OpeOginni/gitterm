import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { SandboxBackend } from "./backend.js";
import { projectDir, safeRelativePath, type SourceSnapshot } from "./source.js";

export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

export type FetchedArtifact = {
  remotePath: string;
  /** Outside the checkout. Local project files are untouched until `applyArtifact`. */
  localPath: string;
  sha256: string;
  bytes: number;
  /** The downloaded bytes match the sha256 computed inside the sandbox. */
  verified: boolean;
};

export function artifactDirectory(): string {
  const base = process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache");
  return path.join(base, "gitterm", "sandbox-artifacts");
}

const q = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

/** Relative paths resolve from the sandbox project directory. */
export function remotePath(home: string, file: string): string {
  const resolved = file.startsWith("/")
    ? path.posix.normalize(file)
    : path.posix.join(projectDir(home), file);
  if (resolved.includes("\0") || resolved.split("/").includes(".."))
    throw new Error("Invalid sandbox path");
  return resolved;
}

export async function fetchArtifact(
  backend: SandboxBackend,
  sandboxId: string,
  file: string,
  options: { maxBytes?: number } = {},
): Promise<FetchedArtifact> {
  const remote = remotePath(backend.home, file);
  const maxBytes = options.maxBytes ?? MAX_ARTIFACT_BYTES;
  const probe = await backend.run(
    sandboxId,
    `[ -f ${q(remote)} ] || exit 3; wc -c < ${q(remote)}; sha256sum ${q(remote)} | cut -d' ' -f1`,
    { timeoutMs: 60_000 },
  );
  if (probe.exitCode === 3) throw new Error(`No regular file at ${remote} in the sandbox`);
  if (probe.exitCode !== 0) throw new Error("Could not inspect the artifact in the sandbox");
  const [sizeLine, remoteHash] = probe.stdout.trim().split("\n");
  if (Number(sizeLine) > maxBytes)
    throw new Error(`Artifact is larger than ${Math.round(maxBytes / 1024 / 1024)} MiB`);
  const data = await backend.readFile(sandboxId, remote);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const directory = path.join(
    artifactDirectory(),
    `${backend.identity.mode}-${backend.identity.account}`,
    sandboxId,
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const localPath = path.join(directory, `${sha256.slice(0, 12)}-${path.posix.basename(remote)}`);
  await writeFile(localPath, data, { mode: 0o600 });
  return {
    remotePath: remote,
    localPath,
    sha256,
    bytes: data.byteLength,
    verified: sha256 === remoteHash?.trim(),
  };
}

export class ArtifactConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactConflictError";
  }
}

/**
 * Copies a fetched artifact into the checkout. Refuses when the local target changed
 * since the snapshot the job ran on, so remote output never overwrites newer local work.
 */
export async function applyArtifact(input: {
  artifact: Pick<FetchedArtifact, "localPath" | "sha256">;
  snapshot: Pick<SourceSnapshot, "root" | "files" | "id">;
  target: string;
}): Promise<{ path: string; sha256: string }> {
  if (!safeRelativePath(input.target))
    throw new Error("Target must be a relative path inside the checkout");
  // These exact bytes are verified and written; the source file is not reopened.
  const data = await readFile(input.artifact.localPath);
  if (createHash("sha256").update(data).digest("hex") !== input.artifact.sha256)
    throw new ArtifactConflictError(
      "The fetched artifact changed on disk since it was downloaded.",
    );
  const root = await realpath(input.snapshot.root);
  // Every parent must be a real directory inside the checkout, never a symlink out of it.
  const parts = input.target.split("/");
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    const info = await lstat(directory).catch(() => null);
    if (!info) await mkdir(directory);
    else if (info.isSymbolicLink() || !info.isDirectory())
      throw new ArtifactConflictError(
        `${path.relative(root, directory)} is not a directory inside the checkout.`,
      );
  }
  const destination = path.join(directory, parts.at(-1)!);
  const expected = input.snapshot.files.find((file) => file.path === input.target);
  const current = await lstat(destination).catch(() => null);
  if (current?.isSymbolicLink() || (current && !current.isFile()))
    throw new ArtifactConflictError(`${input.target} is not a regular file locally.`);
  const currentHash = current
    ? createHash("sha256")
        .update(await readFile(destination))
        .digest("hex")
    : null;
  if ((expected?.sha256 ?? null) !== currentHash)
    throw new ArtifactConflictError(
      `${input.target} changed locally since snapshot ${input.snapshot.id}. Sync again and rerun before applying.`,
    );
  const temporary = path.join(directory, `.gitterm-${randomBytes(6).toString("hex")}`);
  try {
    await writeFile(temporary, data, { flag: "wx" });
    // A parent swapped for a symlink after the checks above must not redirect the rename.
    if ((await realpath(directory)) !== directory)
      throw new ArtifactConflictError("The checkout changed while applying the artifact.");
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return { path: input.target, sha256: input.artifact.sha256 };
}
