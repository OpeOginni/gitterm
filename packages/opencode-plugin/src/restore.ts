import { DIFF_ARGS } from "./snapshot";

// Runs only in a newly provisioned cloud checkout. No source checkout is modified.
// Keep this script self-contained: it is executed by the workspace's Node runtime.
export const RESTORE_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const stage = process.argv[1];
if (!/^\.gitterm-handoff-[a-f0-9-]+$/.test(stage)) throw new Error("Invalid staging directory");
const diffArgs = ${JSON.stringify(DIFF_ARGS)};
const git = (...args) => cp.execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.quotePath=true", ...args], { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const safePath = file => typeof file === "string" && file.length > 0 && !file.includes("\\") && !file.includes("\0") && !path.posix.isAbsolute(file) && file.split("/").every(part => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git");
try {
  const snapshot = JSON.parse(fs.readFileSync(path.join(stage, "snapshot.json"), "utf8"));
  if (snapshot.version !== 1 || !/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(snapshot.head)) throw new Error("Invalid snapshot");
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").toString().split("\0").filter(Boolean);
  if (git("diff", "HEAD", "--").length || git("diff", "--cached", "HEAD", "--").length || untracked.some(file => !file.startsWith(stage + "/"))) throw new Error("Cloud checkout has existing changes");
  const bundle = path.join(stage, "checkout.bundle");
  fs.writeFileSync(bundle, Buffer.from(snapshot.bundle, "base64"), { mode: 0o600 });
  git("bundle", "verify", bundle);
  git("fetch", "--no-tags", "./" + bundle, "HEAD");
  if (git("rev-parse", "FETCH_HEAD").toString().trim() !== snapshot.head) throw new Error("Bundle revision mismatch");
  git("checkout", "--no-overwrite-ignore", "-b", "gitterm/" + stage.slice(".gitterm-handoff-".length), "FETCH_HEAD");
  if (snapshot.staged) {
    const patch = path.join(stage, "staged.patch");
    fs.writeFileSync(patch, Buffer.from(snapshot.staged, "base64"));
    git("apply", "--index", "--binary", "--whitespace=nowarn", patch);
  }
  if (snapshot.unstaged) {
    const patch = path.join(stage, "unstaged.patch");
    fs.writeFileSync(patch, Buffer.from(snapshot.unstaged, "base64"));
    git("apply", "--binary", "--whitespace=nowarn", patch);
  }
  for (const file of snapshot.files) {
    if (!safePath(file.path)) throw new Error("Unsafe file path");
    const pieces = file.path.split("/");
    let directory = process.cwd();
    for (const piece of pieces.slice(0, -1)) {
      directory = path.join(directory, piece);
      if (!fs.existsSync(directory)) fs.mkdirSync(directory);
      if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error("Unsafe parent directory");
    }
    fs.writeFileSync(file.path, Buffer.from(file.data, "base64"), { flag: "wx", mode: file.executable ? 0o755 : 0o644 });
  }
  fs.rmSync(stage, { recursive: true });
  const restoredUntracked = git("ls-files", "--others", "--exclude-standard", "-z").toString().split("\0").filter(Boolean).sort();
  const expectedUntracked = snapshot.files.map(file => file.path).sort();
  if (JSON.stringify(restoredUntracked) !== JSON.stringify(expectedUntracked)) throw new Error("Untracked file inventory mismatch");
  const files = snapshot.files.map(file => ({ path: file.path, data: fs.readFileSync(file.path).toString("base64"), executable: Boolean(fs.statSync(file.path).mode & 0o111) }));
  const state = { head: git("rev-parse", "HEAD").toString().trim(), staged: git("diff", ...diffArgs, "--cached", "HEAD", "--").toString("base64"), unstaged: git("diff", ...diffArgs, "--").toString("base64"), files, changedPaths: snapshot.changedPaths };
  const digest = crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
  if (digest !== snapshot.digest) throw new Error("Restored checkout verification failed");
  process.stdout.write("GITTERM_HANDOFF_VERIFIED");
} catch {
  // Never print patches, files, credentials, or upstream command output.
  process.stderr.write("GitTerm checkout restoration failed. Local files are unchanged.\n");
  process.exitCode = 1;
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
`;

export const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
