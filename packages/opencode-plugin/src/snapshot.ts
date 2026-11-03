import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;
export const DIFF_ARGS = [
  "--binary",
  "--full-index",
  "--no-ext-diff",
  "--no-textconv",
  "--no-renames",
  "--no-color",
  "--unified=3",
  "--inter-hunk-context=0",
  "--diff-algorithm=myers",
  "--no-indent-heuristic",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

export async function git(
  directory: string,
  args: string[],
  maxBytes = MAX_SNAPSHOT_BYTES,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "core.quotePath=true", ...args],
      {
        cwd: directory,
        encoding: "buffer",
        maxBuffer: maxBytes,
        timeout: 60_000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout) => {
        // Git errors can contain credential-bearing origin URLs or file contents.
        if (error)
          reject(
            new Error(
              "Git snapshot operation failed. Check repository access, unresolved conflicts, and snapshot size.",
            ),
          );
        else resolve(stdout);
      },
    );
  });
}

export async function checkoutRoot(directory: string): Promise<string> {
  return realpath((await git(directory, ["rev-parse", "--show-toplevel"])).toString().trim());
}

export function safeRelativePath(file: string): boolean {
  return (
    Boolean(file) &&
    !file.includes("\\") &&
    !file.includes("\0") &&
    !path.posix.isAbsolute(file) &&
    file
      .split("/")
      .every(
        (part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git",
      )
  );
}

export function sensitivePath(file: string): boolean {
  return /(^|\/)(\.env($|\.(?!example$|sample$|template$))|id_(rsa|ed25519|ecdsa)($|\.)|credentials(?:\.json)?$)|\.(pem|p12|pfx|key)$/i.test(
    file,
  );
}

export type SnapshotFile = { path: string; data: string; executable: boolean };
export type WorkingState = {
  head: string;
  staged: string;
  unstaged: string;
  files: SnapshotFile[];
  changedPaths: string[];
};
export type CheckoutSnapshot = WorkingState & {
  version: 1;
  bundle: string;
  digest: string;
  bytes: number;
};

const nulList = (buffer: Buffer) => {
  if (!Buffer.from(buffer.toString()).equals(buffer))
    throw new Error("Non-UTF-8 filenames are not supported by cloud handoff.");
  return buffer.toString().split("\0").filter(Boolean);
};
export const stateDigest = (state: WorkingState) =>
  createHash("sha256").update(JSON.stringify(state)).digest("hex");

async function readWorkingState(root: string, includeChanges: boolean): Promise<WorkingState> {
  const head = (await git(root, ["rev-parse", "HEAD"])).toString().trim();
  if ((await git(root, ["ls-files", "--unmerged", "-z"])).length) {
    throw new Error("Resolve merge conflicts before continuing in the cloud.");
  }
  // Gitlinks need their own object/state transfer; don't silently omit them.
  if (
    (await git(root, ["ls-files", "--stage"]))
      .toString()
      .split("\n")
      .some((line) => line.startsWith("160000 "))
  ) {
    throw new Error("Cloud handoff does not support submodules yet.");
  }
  if (!includeChanges) return { head, staged: "", unstaged: "", files: [], changedPaths: [] };
  if ((await git(root, ["diff", "--name-only", "--diff-filter=A", "--"])).length) {
    throw new Error("Stage or unstage intent-to-add files before cloud handoff.");
  }

  const stagedBytes = await git(root, ["diff", ...DIFF_ARGS, "--cached", "HEAD", "--"]);
  const unstagedBytes = await git(root, ["diff", ...DIFF_ARGS, "--"]);
  if (
    /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(
      stagedBytes.toString() + unstagedBytes.toString(),
    )
  ) {
    throw new Error("Private key material detected in changed files. Remove it before uploading.");
  }
  // Patches can contain non-UTF-8 text; preserve their bytes, not decoded strings.
  const staged = stagedBytes.toString("base64");
  const unstaged = unstagedBytes.toString("base64");
  const untracked = nulList(
    await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ).toSorted();
  const changedPaths = [
    ...new Set([
      ...nulList(await git(root, ["diff", "--name-only", "-z", "--no-renames", "HEAD", "--"])),
      ...nulList(await git(root, ["diff", "--name-only", "-z", "--cached", "HEAD", "--"])),
      ...untracked,
    ]),
  ].toSorted();
  for (const file of changedPaths) {
    if (!safeRelativePath(file))
      throw new Error("The checkout contains a path that cannot be transferred safely.");
    if (sensitivePath(file))
      throw new Error(
        `Potential secret file ${JSON.stringify(file)} is changed. Exclude it or continue without uncommitted changes.`,
      );
  }

  let bytes = stagedBytes.length + unstagedBytes.length;
  const files: SnapshotFile[] = [];
  for (const file of untracked) {
    const full = path.join(root, file);
    const info = await lstat(full);
    if (!info.isFile() || (await realpath(full)) !== full) {
      throw new Error(
        "Untracked symlinks, nested repositories, and special files are not supported.",
      );
    }
    bytes += info.size;
    if (bytes > MAX_SNAPSHOT_BYTES)
      throw new Error("Uncommitted changes exceed the 25 MiB handoff limit.");
    const content = await readFile(full);
    if (
      content.includes(Buffer.from("-----BEGIN PRIVATE KEY-----")) ||
      content.includes(Buffer.from("-----BEGIN RSA PRIVATE KEY-----"))
    ) {
      throw new Error(
        `Private key material detected in ${JSON.stringify(file)}. Remove it before uploading.`,
      );
    }
    files.push({
      path: file,
      data: content.toString("base64"),
      executable: Boolean(info.mode & 0o111),
    });
  }
  return { head, staged, unstaged, files, changedPaths };
}

export async function captureSnapshot(
  directory: string,
  includeChanges: boolean,
): Promise<CheckoutSnapshot> {
  const root = await checkoutRoot(directory);
  const temporary = await mkdtemp(path.join(tmpdir(), "gitterm-handoff-"));
  try {
    const before = await readWorkingState(root, includeChanges);
    const bundlePath = path.join(temporary, "checkout.bundle");
    // A self-contained bundle also carries commits that have never been pushed.
    await git(root, ["bundle", "create", bundlePath, "HEAD"]);
    const bundleSize = (await stat(bundlePath)).size;
    if (bundleSize > MAX_SNAPSHOT_BYTES)
      throw new Error("Repository history exceeds the 25 MiB handoff limit.");
    const bundle = (await readFile(bundlePath)).toString("base64");
    const after = await readWorkingState(root, includeChanges);
    const digest = stateDigest(before);
    if (digest !== stateDigest(after))
      throw new Error("The checkout changed during capture. Pause writers and retry.");
    const bytes =
      bundleSize +
      Buffer.from(before.staged, "base64").length +
      Buffer.from(before.unstaged, "base64").length +
      before.files.reduce((sum, file) => sum + Buffer.from(file.data, "base64").length, 0);
    if (bytes > MAX_SNAPSHOT_BYTES)
      throw new Error("Checkout snapshot exceeds the 25 MiB handoff limit.");
    return { version: 1, ...before, bundle, digest, bytes };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function repositoryUrl(root: string): Promise<string> {
  const url = (await git(root, ["remote", "get-url", "origin"])).toString().trim();
  // Don't forward embedded local credentials or machine-local paths to GitTerm.
  if (/^https:\/\//i.test(url)) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error("Use a credential-free origin URL and a GitTerm repository connection.");
    return parsed.href;
  }
  const ssh = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([^\s]+)$/.exec(url);
  if (ssh?.[1]) return `https://github.com/${ssh[1]}`;
  throw new Error(
    "Cloud handoff needs an HTTPS origin (or a GitHub SSH origin). Configure repository access in GitTerm.",
  );
}

export async function sharedCheckoutSessions(
  root: string,
  sessionID: string,
  sessions: Array<{ id: string; location: { directory: string } }>,
): Promise<string[]> {
  const matches: string[] = [];
  for (const session of sessions) {
    if (session.id === sessionID) continue;
    try {
      if ((await checkoutRoot(session.location.directory)) === root) matches.push(session.id);
    } catch {
      /* A session may refer to a missing or inaccessible checkout. */
    }
  }
  return matches;
}
