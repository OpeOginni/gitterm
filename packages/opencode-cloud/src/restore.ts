import { execFile } from "node:child_process";

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

/**
 * A PEM private key: the header, a real or escaped (JSON) line break, optional PEM headers, then
 * key data. Code that merely mentions the header, like this detector, has no key data after it.
 * In a diff each line starts with "+", "-" or " ", so that prefix is allowed after a break.
 */
const PRIVATE_KEY =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----(?:\r?\n[+\- ]?|(?:\\r)?\\n)(?:[A-Za-z-]+: [^\r\n]*(?:\r?\n[+\- ]?|(?:\\r)?\\n))*(?:\r?\n[+\- ]?|(?:\\r)?\\n)?[A-Za-z0-9+/]{16}/;
const SENSITIVE_PATH =
  /(^|\/)(\.env($|\.(?!(?:[^/]*\.)?(?:example|sample|template)$))|id_(rsa|ed25519|ecdsa)($|\.)|credentials(?:\.json)?$)|\.(pem|p12|pfx|key)$/i;
/** Whether a changed path looks like a secret file, which is not uploaded. */
export const sensitivePath = (file: string) => SENSITIVE_PATH.test(file);

/** Exit code when the checkout lacks commits the snapshot builds on; nothing was changed. */
export const RESTORE_NEEDS_FULL_HISTORY = 3;
/** Exit code when a return would replace local work and nobody has agreed to it yet; nothing was changed. */
export const RESTORE_NEEDS_CONFIRMATION = 4;
/** Capture exit codes: the checkout cannot be transferred as it is, is too large, changed meanwhile, or holds a secret. */
export const CAPTURE_UNSUPPORTED = 10;
export const CAPTURE_TOO_LARGE = 11;
export const CAPTURE_BUSY = 12;
export const CAPTURE_SECRET = 13;

/**
 * Runs one of the scripts below in a local checkout. OpenCode is a Bun executable, which runs
 * a script itself when asked to, so this needs no Node on the user's machine.
 */
export function runLocalScript(root: string, script: string, args: string[]) {
  return new Promise<{ exit: number; stdout: string }>((resolve) => {
    execFile(
      process.execPath,
      ["-e", script, ...args],
      {
        cwd: root,
        env: { ...process.env, BUN_BE_BUN: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
        timeout: 120_000,
      },
      (error, stdout) =>
        resolve({
          exit: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: String(stdout),
        }),
    );
  });
}

// The scripts below run inside a checkout, as `node -e <script> <stage> ...`: in the cloud
// through the workspace's Node, locally through OpenCode's own runtime. They are
// self-contained, and share this start so both describe a checkout's state the same way.
const PRELUDE = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const stage = process.argv[1];
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
`;

// `node -e <script> <stage> [session subdirectory] [handed-off state] [force]`.
//
// It either leaves the checkout exactly as the snapshot describes, or exactly as it found
// it, so a failed handoff can be retried in the same workspace. A note in the Git directory
// records what it restored, which lets a retry recognise its own earlier work.
//
// Going to the cloud, a checkout holding anything else is refused. Coming back, the third
// argument is the digest of the state the local checkout was handed off in: if it is still
// in that state it is replaced; otherwise the script stops with RESTORE_NEEDS_CONFIRMATION
// until run again with "force", and then keeps what it replaces in a stash and a branch.
export const RESTORE_SCRIPT =
  PRELUDE +
  String.raw`
const subpath = process.argv[2] || "";
const expected = process.argv[3] || "";
const force = process.argv[4] === "force";
const clean = () => { git("reset", "--hard", "-q"); git("clean", "-fdq", "-e", stage); };
let undo = null;
let report = "";
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
  let current = null;
  try { current = digest(state([])); } catch {}
  const untouched = current !== null && ((earlier !== null && current === earlier.state) || (expected !== "" && current === expected));
  if (!(untouched && earlier !== null && earlier.snapshot === snapshot.digest)) {
    if (!untouched && expected) {
      if (!force) throw Object.assign(new Error("Local checkout changed since the handoff"), { needsConfirmation: true });
    } else if (!untouched) {
      // Never replace work done in the cloud since an earlier restore, committed or not.
      if (earlier) throw new Error("Cloud checkout changed since the earlier handoff");
      if (git("diff", "HEAD", "--").length || git("diff", "--cached", "HEAD", "--").length || untracked().length) throw new Error("Cloud checkout has existing changes");
    }

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
    const unique = commit => Boolean(commit) && text("rev-list", "-1", commit, "--not", "--remotes", snapshot.head) !== "";
    if (!expected && !earlier && unique(before.target)) throw new Error("Cloud branch has commits the snapshot lacks");
    const id = stage.slice(".gitterm-handoff-".length);
    const kept = { stash: false, branch: null };
    // What is replaced is kept aside until the new state is verified. Work the user did
    // since the handoff stays kept afterwards; an earlier restore of ours does not.
    const keep = Boolean(expected) && !untouched;
    const tip = before.target || (before.branch ? null : before.sha);
    if (keep && unique(tip)) {
      kept.branch = "gitterm/before-return-" + id;
      git("branch", "-f", kept.branch, tip);
    }
    const stashed = () => has("rev-parse", "-q", "--verify", "refs/stash") ? text("rev-parse", "refs/stash") : null;
    let saved = false;
    if (earlier || expected) {
      const top = stashed();
      const identity = has("config", "user.email") ? [] : ["-c", "user.name=GitTerm", "-c", "user.email=handoff@gitterm.invalid"];
      git(...identity, "stash", "push", "--include-untracked", "-q", "-m", "GitTerm: replaced by cloud handoff " + id, "--", ":(exclude)" + stage);
      saved = stashed() !== top;
    }
    undo = () => {
      clean();
      if (before.branch) git("checkout", "-f", "-q", "-B", before.branch, before.sha); else git("checkout", "-f", "-q", "--detach", before.sha);
      if (branch !== before.branch) { if (before.target) git("branch", "-f", branch, before.target); else has("branch", "-D", branch); }
      if (kept.branch) has("branch", "-D", kept.branch);
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
    if (saved && keep) kept.stash = true; else if (saved) git("stash", "drop", "-q");
    if (expected) report = " " + JSON.stringify(kept);
  }
  if (subpath) fs.mkdirSync(subpath, { recursive: true });
  // A return also says what it kept of the checkout it replaced.
  process.stdout.write("GITTERM_HANDOFF_VERIFIED" + report);
} catch (error) {
  // Put the checkout back, so the same workspace can take another attempt.
  if (undo) try { undo(); } catch {}
  // Never print patches, files, credentials, or upstream command output.
  process.stderr.write("GitTerm checkout restoration failed. Local files are unchanged.\n");
  process.exitCode = error && error.needsFullHistory ? ${RESTORE_NEEDS_FULL_HISTORY} : error && error.needsConfirmation ? ${RESTORE_NEEDS_CONFIRMATION} : 1;
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
`;

// `node -e <script> <stage> <options as JSON>`. Writes the checkout's state to snapshot.bin in
// the format RESTORE_SCRIPT reads, leaving the checkout untouched. It is the one way a
// checkout is captured, in both directions. Options:
//   base     a commit the other side has: the bundle holds only the commits after it.
//            Without one it holds the whole history.
//   changes  include uncommitted changes (staged, unstaged, untracked). Otherwise commits only.
//   screen   refuse changes that look like secrets; set when the snapshot leaves the machine.
//   out      directory to write snapshot.bin to, instead of <stage> inside the checkout.
// On failure it exits with a CAPTURE_* code and prints the reason as one line of JSON: a
// name, and at most a path. Never file contents or command output.
export const CAPTURE_SCRIPT =
  PRELUDE +
  String.raw`
const options = JSON.parse(process.argv[2] || "{}");
const base = options.base || "";
const out = options.out || stage;
const limit = ${MAX_SNAPSHOT_BYTES};
const privateKey = new RegExp(${JSON.stringify(PRIVATE_KEY.source)});
const sensitive = new RegExp(${JSON.stringify(SENSITIVE_PATH.source)}, "i");
const fail = (code, reason, detail) => Object.assign(new Error(reason), { code, report: { reason, ...detail } });
const unsupported = reason => fail(${CAPTURE_UNSUPPORTED}, reason);
const list = buffer => {
  if (!Buffer.from(buffer.toString()).equals(buffer)) throw unsupported("filename");
  return buffer.toString().split("\0").filter(Boolean);
};
const paths = () => [...new Set([...list(git("diff", "--name-only", "-z", "--no-renames", "HEAD", "--")), ...list(git("diff", "--name-only", "-z", "--cached", "HEAD", "--")), ...untracked()])].sort();
const read = () => options.changes ? state(paths()) : { head: text("rev-parse", "HEAD"), staged: "", unstaged: "", files: [], changedPaths: [] };
try {
  if (base && !/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(base)) throw new Error("Invalid base");
  // Merge conflicts, submodules, intent-to-add entries and untracked special files need
  // more than patches and file contents to reproduce.
  if (git("ls-files", "--unmerged", "-z").length) throw unsupported("conflicts");
  if (git("ls-files", "--stage").toString().split("\n").some(line => line.startsWith("160000 "))) throw unsupported("submodules");
  if (options.changes) {
    if (git("diff", "--name-only", "--diff-filter=A", "--").length) throw unsupported("intent-to-add");
    list(git("ls-files", "--others", "--exclude-standard", "-z"));
    for (const file of paths()) {
      if (!safePath(file)) throw unsupported("unsafe-path");
      if (options.screen && sensitive.test(file)) throw fail(${CAPTURE_SECRET}, "secret-path", { path: file });
    }
    // Look at sizes and kinds before reading anything into memory.
    let size = 0;
    for (const file of untracked()) {
      const info = fs.lstatSync(file);
      if (!info.isFile() || fs.realpathSync(file) !== path.resolve(fs.realpathSync("."), file)) throw unsupported("special-file");
      size += info.size;
      if (size > limit) throw fail(${CAPTURE_TOO_LARGE}, "too-large", { part: "changes" });
    }
  }
  const before = read();
  const parts = [Buffer.alloc(0), Buffer.from(before.staged, "base64"), Buffer.from(before.unstaged, "base64"), ...before.files.map(file => Buffer.from(file.data, "base64"))];
  if (options.screen) {
    if (privateKey.test(parts[1].toString() + parts[2].toString())) throw fail(${CAPTURE_SECRET}, "private-key");
    before.files.forEach((file, index) => { if (privateKey.test(parts[3 + index].toString("latin1"))) throw fail(${CAPTURE_SECRET}, "private-key", { path: file.path }); });
  }
  if (parts.reduce((sum, part) => sum + part.length, 0) > limit) throw fail(${CAPTURE_TOO_LARGE}, "too-large", { part: "changes" });
  const known = base && has("cat-file", "-e", base + "^{commit}");
  const commits = known ? ["HEAD", "^" + base] : ["HEAD"];
  // Git refuses to write a bundle with no commits in it.
  if (Number(text("rev-list", "--count", ...commits)) > 0) {
    const file = path.join(out, "checkout.bundle");
    git("bundle", "create", file, ...commits);
    if (fs.statSync(file).size > limit) throw fail(${CAPTURE_TOO_LARGE}, "too-large", { part: known ? "commits" : "history" });
    parts[0] = fs.readFileSync(file);
    fs.rmSync(file);
  }
  const snapshotDigest = digest(before);
  if (digest(read()) !== snapshotDigest) throw fail(${CAPTURE_BUSY}, "busy");
  if (parts.reduce((sum, part) => sum + part.length, 0) > limit) throw fail(${CAPTURE_TOO_LARGE}, "too-large", { part: "total" });
  const manifest = Buffer.from(JSON.stringify({
    version: 2,
    head: before.head,
    branch: has("symbolic-ref", "-q", "HEAD") ? text("symbolic-ref", "--short", "HEAD") : null,
    digest: snapshotDigest,
    // The same state without the list of changed paths: what a restore compares a checkout with.
    state: digest({ ...before, changedPaths: [] }),
    changedPaths: before.changedPaths,
    bundle: parts[0].length,
    staged: parts[1].length,
    unstaged: parts[2].length,
    files: before.files.map((file, index) => ({ path: file.path, executable: file.executable, size: parts[3 + index].length })),
  }));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(manifest.length);
  fs.writeFileSync(path.join(out, "snapshot.bin"), Buffer.concat([header, manifest, ...parts]), { mode: 0o600 });
  process.stdout.write("GITTERM_CAPTURE_READY");
} catch (error) {
  fs.rmSync(stage, { recursive: true, force: true });
  if (error && error.report) process.stdout.write(JSON.stringify(error.report));
  process.stderr.write("GitTerm checkout capture failed. The checkout is unchanged.\n");
  process.exitCode = (error && error.code) || 1;
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
