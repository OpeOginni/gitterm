import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CAPTURE_SCRIPT, MAX_SNAPSHOT_BYTES, runLocalScript } from "./restore";

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

/** What an encoded snapshot says about itself, without its contents. */
export type SnapshotSummary = {
  head: string;
  /** The checked-out branch, recreated under the same name on the other side; null when detached. */
  branch: string | null;
  /** Digest of the captured state; a restore verifies the checkout against it. */
  digest: string;
  /** Digest a restore records for a checkout left in this state, to recognise it later. */
  state: string;
  changedPaths: string[];
  /** Size of the commits, patches and files it carries. */
  bytes: number;
};
/**
 * A checkout's state as one upload: a 4-byte length, a JSON manifest, then the raw bytes of
 * the Git bundle, the staged and unstaged patches and each untracked file.
 */
export type CheckoutSnapshot = SnapshotSummary & { encoded: Buffer };

export function snapshotSummary(encoded: Uint8Array): SnapshotSummary {
  const buffer = Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  const manifest = JSON.parse(
    buffer.subarray(4, 4 + buffer.readUInt32BE(0)).toString("utf8"),
  ) as Omit<SnapshotSummary, "bytes"> & {
    bundle: number;
    staged: number;
    unstaged: number;
    files: Array<{ size: number }>;
  };
  return {
    head: manifest.head,
    branch: manifest.branch,
    digest: manifest.digest,
    state: manifest.state,
    changedPaths: manifest.changedPaths,
    bytes:
      manifest.bundle +
      manifest.staged +
      manifest.unstaged +
      manifest.files.reduce((sum, file) => sum + file.size, 0),
  };
}

/**
 * The commit origin's default branch pointed at when this checkout last fetched. A new
 * workspace clones that branch, so everything reachable from here is already there.
 */
async function originBase(root: string): Promise<string> {
  try {
    const base = await git(root, ["rev-parse", "--verify", "refs/remotes/origin/HEAD^{commit}"]);
    return base.toString().trim();
  } catch {
    return "";
  }
}

function captureFailure(stdout: string): string {
  let report: { reason?: string; path?: string; part?: string } = {};
  try {
    report = JSON.parse(stdout);
  } catch {
    /* The script printed nothing: Git itself failed. */
  }
  const file = report.path ? JSON.stringify(report.path) : "";
  switch (report.reason) {
    case "no-commits":
      return "Commit at least once before continuing in the cloud.";
    case "conflicts":
      return "Resolve merge conflicts before continuing in the cloud.";
    case "submodules":
      // Gitlinks need their own object/state transfer; don't silently omit them.
      return "Cloud handoff does not support submodules yet.";
    case "intent-to-add":
      return "Stage or unstage intent-to-add files before cloud handoff.";
    case "filename":
      return "Non-UTF-8 filenames are not supported by cloud handoff.";
    case "unsafe-path":
      return "The checkout contains a path that cannot be transferred safely.";
    case "special-file":
      return "Untracked symlinks, nested repositories, and special files are not supported.";
    case "secret-path":
      return `Potential secret file ${file} is changed. Exclude it or continue without uncommitted changes.`;
    case "private-key":
      return `Private key material detected in ${file || "changed files"}. Remove it before uploading.`;
    case "too-large":
      return (
        {
          changes: "Uncommitted changes exceed the 25 MiB handoff limit.",
          commits:
            "Commits that are not on origin's default branch exceed the 25 MiB handoff limit.",
          history: "Repository history exceeds the 25 MiB handoff limit.",
        }[report.part ?? ""] ?? "Checkout snapshot exceeds the 25 MiB handoff limit."
      );
    case "busy":
      return "The checkout changed during capture. Pause writers and retry.";
    default:
      return "Git snapshot operation failed. Check repository access, unresolved conflicts, and snapshot size.";
  }
}

/**
 * Captures the local checkout for upload: its commits that origin's default branch lacks,
 * and its uncommitted changes when asked for. Changes that look like secrets are refused.
 *
 * `fullHistory` bundles every commit instead. Restoring asks for it when the cloud clone
 * does not have the commits a smaller bundle builds on (origin's default branch was
 * rewritten since the last fetch, or the clone is shallow).
 */
export async function captureSnapshot(
  directory: string,
  includeChanges: boolean,
  fullHistory = false,
): Promise<CheckoutSnapshot> {
  const root = await checkoutRoot(directory);
  // Keep capture output outside the checkout so it cannot enter the snapshot.
  const out = await mkdtemp(path.join(tmpdir(), "gitterm-handoff-"));
  try {
    const options = {
      base: fullHistory ? "" : await originBase(root),
      changes: includeChanges,
      screen: true,
      out,
    };
    // Exclude the restore staging directory from capture.
    const result = await runLocalScript(root, CAPTURE_SCRIPT, [
      ".gitterm-handoff-0",
      JSON.stringify(options),
    ]);
    if (result.exit !== 0) throw new Error(captureFailure(result.stdout));
    const encoded = await readFile(path.join(out, "snapshot.bin"));
    return { ...snapshotSummary(encoded), encoded };
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

/** The origin to clone in the cloud, or undefined for a checkout without one. */
export async function repositoryUrl(root: string): Promise<string | undefined> {
  if (!(await git(root, ["remote"])).toString().split("\n").includes("origin")) return undefined;
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
