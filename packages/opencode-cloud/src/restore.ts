import { DIFF_ARGS } from "./snapshot";

/** Exit code when the checkout lacks commits the snapshot builds on; nothing was changed. */
export const RESTORE_NEEDS_FULL_HISTORY = 3;

// Runs in the cloud checkout: `node -e <script> <stage> [session subdirectory]`. No source
// checkout is modified. Keep this script self-contained: the workspace's Node runtime runs it.
//
// It either leaves the checkout exactly as the snapshot describes, or exactly as it found
// it, so a failed handoff can be retried in the same workspace. A note in the Git directory
// records what it restored, which lets a retry recognise its own earlier work.
export const RESTORE_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const stage = process.argv[1];
const subpath = process.argv[2] || "";
if (!/^\.gitterm-handoff-[a-f0-9-]+$/.test(stage)) throw new Error("Invalid staging directory");
const diffArgs = ${JSON.stringify(DIFF_ARGS)};
const git = (...args) => cp.execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.quotePath=true", ...args], { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const text = (...args) => git(...args).toString().trim();
const has = (...args) => { try { git(...args); return true; } catch { return false; } };
const safePath = file => typeof file === "string" && file.length > 0 && !file.includes("\\") && !file.includes("\0") && !path.posix.isAbsolute(file) && file.split("/").every(part => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git");
const untracked = () => git("ls-files", "--others", "--exclude-standard", "-z").toString().split("\0").filter(file => file && !file.startsWith(stage + "/")).sort();
// The checkout as it is now, in the shape the snapshot digest is computed over.
const state = changedPaths => ({ head: text("rev-parse", "HEAD"), staged: git("diff", ...diffArgs, "--cached", "HEAD", "--").toString("base64"), unstaged: git("diff", ...diffArgs, "--").toString("base64"), files: untracked().map(file => ({ path: file, data: fs.readFileSync(file).toString("base64"), executable: Boolean(fs.statSync(file).mode & 0o111) })), changedPaths });
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clean = () => { git("reset", "--hard", "-q"); git("clean", "-fdq", "-e", stage); };
let undo = null;
try {
  // One upload: a 4-byte length, a JSON manifest, then the raw bytes the manifest sizes.
  const raw = fs.readFileSync(path.join(stage, "snapshot.bin"));
  const manifestSize = raw.readUInt32BE(0);
  const snapshot = JSON.parse(raw.subarray(4, 4 + manifestSize).toString("utf8"));
  if (snapshot.version !== 2 || !/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(snapshot.head)) throw new Error("Invalid snapshot");
  if (subpath && !safePath(subpath)) throw new Error("Unsafe session directory");
  let offset = 4 + manifestSize;
  const take = size => { const part = raw.subarray(offset, offset + size); if (!Number.isInteger(size) || part.length !== size) throw new Error("Truncated snapshot"); offset += size; return part; };
  const bundle = take(snapshot.bundle), staged = take(snapshot.staged), unstaged = take(snapshot.unstaged);
  const files = snapshot.files.map(file => ({ path: file.path, executable: file.executable, data: take(file.size) }));

  const note = path.join(text("rev-parse", "--git-dir"), "gitterm-handoff.json");
  let earlier = null;
  try { earlier = JSON.parse(fs.readFileSync(note, "utf8")); } catch {}
  let untouched = false;
  try { untouched = Boolean(earlier) && digest(state([])) === earlier.state; } catch {}
  if (!(untouched && earlier.snapshot === snapshot.digest)) {
    // Never replace work done in the cloud since an earlier restore, committed or not.
    if (earlier && !untouched) throw new Error("Cloud checkout changed since the earlier handoff");
    if (!earlier && (git("diff", "HEAD", "--").length || git("diff", "--cached", "HEAD", "--").length || untracked().length)) throw new Error("Cloud checkout has existing changes");

    // The bundle holds only commits this clone is expected to lack. If the clone does not
    // have what they build on, stop before touching anything and ask for the whole history.
    if (bundle.length) {
      const file = path.join(stage, "checkout.bundle");
      fs.writeFileSync(file, bundle, { mode: 0o600 });
      if (!has("bundle", "verify", file)) throw Object.assign(new Error("Missing base commits"), { needsFullHistory: true });
      git("fetch", "--no-tags", "./" + file, "HEAD");
      if (text("rev-parse", "FETCH_HEAD") !== snapshot.head) throw new Error("Bundle revision mismatch");
    } else if (!has("cat-file", "-e", snapshot.head + "^{commit}")) {
      throw Object.assign(new Error("Missing head commit"), { needsFullHistory: true });
    }

    // Use the local branch name, so pushing from the cloud updates the branch the user expects.
    const branch = typeof snapshot.branch === "string" && has("check-ref-format", "--branch", snapshot.branch) ? snapshot.branch : "gitterm/" + stage.slice(".gitterm-handoff-".length);
    const before = { sha: text("rev-parse", "HEAD"), branch: has("symbolic-ref", "-q", "HEAD") ? text("symbolic-ref", "--short", "HEAD") : null, target: has("show-ref", "--verify", "--quiet", "refs/heads/" + branch) ? text("rev-parse", "refs/heads/" + branch) : null };
    // Moving the branch must not drop commits that exist only in this clone.
    if (!earlier && before.target && text("rev-list", "-1", before.target, "--not", "--remotes", snapshot.head)) throw new Error("Cloud branch has commits the snapshot lacks");
    // An earlier restore being replaced is kept aside until this one is verified.
    const stashed = () => has("rev-parse", "-q", "--verify", "refs/stash") ? text("rev-parse", "refs/stash") : null;
    let saved = false;
    if (earlier) {
      const top = stashed();
      git("-c", "user.name=GitTerm", "-c", "user.email=handoff@gitterm.invalid", "stash", "push", "--include-untracked", "-q", "--", ":(exclude)" + stage);
      saved = stashed() !== top;
    }
    undo = () => {
      clean();
      if (before.branch) git("checkout", "-f", "-q", "-B", before.branch, before.sha); else git("checkout", "-f", "-q", "--detach", before.sha);
      if (branch !== before.branch) { if (before.target) git("branch", "-f", branch, before.target); else has("branch", "-D", branch); }
      if (saved) git("stash", "pop", "--index", "-q");
    };
    git("checkout", "--no-overwrite-ignore", "-q", "-B", branch, snapshot.head);
    if (has("show-ref", "--verify", "--quiet", "refs/remotes/origin/" + branch)) has("branch", "-q", "--set-upstream-to=origin/" + branch);
    if (staged.length) {
      const patch = path.join(stage, "staged.patch");
      fs.writeFileSync(patch, staged);
      git("apply", "--index", "--binary", "--whitespace=nowarn", patch);
    }
    if (unstaged.length) {
      const patch = path.join(stage, "unstaged.patch");
      fs.writeFileSync(patch, unstaged);
      git("apply", "--binary", "--whitespace=nowarn", patch);
    }
    for (const file of files) {
      if (!safePath(file.path)) throw new Error("Unsafe file path");
      const pieces = file.path.split("/");
      let directory = process.cwd();
      for (const piece of pieces.slice(0, -1)) {
        directory = path.join(directory, piece);
        if (!fs.existsSync(directory)) fs.mkdirSync(directory);
        if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error("Unsafe parent directory");
      }
      fs.writeFileSync(file.path, file.data, { flag: "wx", mode: file.executable ? 0o755 : 0o644 });
    }
    if (digest(state(snapshot.changedPaths)) !== snapshot.digest) throw new Error("Restored checkout verification failed");
    fs.writeFileSync(note, JSON.stringify({ snapshot: snapshot.digest, state: digest(state([])) }));
    undo = null;
    if (saved) git("stash", "drop", "-q");
  }
  if (subpath) fs.mkdirSync(subpath, { recursive: true });
  process.stdout.write("GITTERM_HANDOFF_VERIFIED");
} catch (error) {
  // Put the checkout back, so the same workspace can take another attempt.
  if (undo) try { undo(); } catch {}
  // Never print patches, files, credentials, or upstream command output.
  process.stderr.write("GitTerm checkout restoration failed. Local files are unchanged.\n");
  process.exitCode = error && error.needsFullHistory ? ${RESTORE_NEEDS_FULL_HISTORY} : 1;
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
`;

// Runs in the cloud checkout: `node -e <script> <stage>`. Starts from an empty upload
// directory: an attempt that was killed can leave its own behind, and only that attempt
// uses the name. A link planted under the name is removed, never followed.
export const PREPARE_STAGE_SCRIPT = String.raw`
const fs = require("node:fs");
const stage = process.argv[1];
if (!/^\.gitterm-handoff-[a-f0-9-]+$/.test(stage)) throw new Error("Invalid staging directory");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { mode: 0o700 });
`;

export const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
