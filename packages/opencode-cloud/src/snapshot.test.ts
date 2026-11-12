import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  captureSnapshot,
  checkoutRoot,
  git,
  repositoryUrl,
  sharedCheckoutSessions,
  snapshotSummary,
  type CheckoutSnapshot,
} from "./snapshot";
import {
  CAPTURE_SCRIPT,
  DIFF_ARGS,
  sensitivePath,
  CAPTURE_UNSUPPORTED,
  PREPARE_STAGE_SCRIPT,
  RESTORE_NEEDS_CONFIRMATION,
  RESTORE_NEEDS_FULL_HISTORY,
  RESTORE_SCRIPT,
} from "./restore";

const execute = promisify(execFile);
let temporary: string;
let source: string;
let cloud: string;

beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), "gitterm-handoff-test-"));
  source = path.join(temporary, "source");
  cloud = path.join(temporary, "cloud");
  await mkdir(source);
  await git(source, ["init", "-b", "main"]);
  await git(source, ["config", "user.name", "Test"]);
  await git(source, ["config", "user.email", "test@example.com"]);
  await writeFile(path.join(source, "hello.txt"), "initial\n");
  await writeFile(path.join(source, "delete.txt"), "remove me\n");
  await writeFile(path.join(source, "image.bin"), Buffer.from([0, 1, 2, 255]));
  await writeFile(path.join(source, ".gitignore"), ".env\nignored/\n");
  await git(source, ["add", "."]);
  await git(source, ["commit", "-m", "initial"]);
  await git(temporary, ["clone", source, cloud]);
});

afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});

type Contents = {
  digest: string;
  bundle: Buffer;
  staged: Buffer;
  unstaged: Buffer;
  files: Array<{ path: string; executable: boolean; data: Buffer }>;
};
/** What a snapshot carries, for tests that look inside one. */
function contents(encoded: Buffer): Contents {
  const size = encoded.readUInt32BE(0);
  const manifest = JSON.parse(encoded.subarray(4, 4 + size).toString("utf8"));
  let offset = 4 + size;
  const take = (length: number) => encoded.subarray(offset, (offset += length));
  return {
    ...manifest,
    bundle: take(manifest.bundle),
    staged: take(manifest.staged),
    unstaged: take(manifest.unstaged),
    files: manifest.files.map((file: { path: string; executable: boolean; size: number }) => ({
      path: file.path,
      executable: file.executable,
      data: take(file.size),
    })),
  };
}
/** The snapshot after `change`, as something on the way could have altered it. */
function tampered(snapshot: { encoded: Buffer }, change: (inside: Contents) => void) {
  const inside = contents(snapshot.encoded);
  change(inside);
  const manifest = Buffer.from(
    JSON.stringify({
      ...inside,
      bundle: inside.bundle.length,
      staged: inside.staged.length,
      unstaged: inside.unstaged.length,
      files: inside.files.map((file) => ({
        path: file.path,
        executable: file.executable,
        size: file.data.length,
      })),
    }),
  );
  const header = Buffer.alloc(4);
  header.writeUInt32BE(manifest.length);
  const parts = [inside.bundle, inside.staged, inside.unstaged, ...inside.files.map((f) => f.data)];
  return { encoded: Buffer.concat([header, manifest, ...parts]) };
}

async function restore(snapshot: { encoded: Buffer }) {
  const stage = ".gitterm-handoff-1234-abcd";
  await execute("node", ["-e", PREPARE_STAGE_SCRIPT, stage], { cwd: cloud });
  await writeFile(path.join(cloud, stage, "snapshot.bin"), snapshot.encoded);
  return execute("node", ["-e", RESTORE_SCRIPT, stage], { cwd: cloud, maxBuffer: 1024 * 1024 });
}

describe("checkout snapshot restoration", () => {
  test("preserves unpublished commits, staged and unstaged edits, binary files, deletions, and untracked modes", async () => {
    await writeFile(path.join(source, "unpublished.txt"), "not on origin\n");
    await git(source, ["add", "unpublished.txt"]);
    await git(source, ["commit", "-m", "local only"]);
    await writeFile(path.join(source, "hello.txt"), "staged\n");
    await git(source, ["add", "hello.txt"]);
    await writeFile(path.join(source, "hello.txt"), "unstaged too\n");
    await writeFile(path.join(source, "image.bin"), Buffer.from([0, 255, 128, 42]));
    await rm(path.join(source, "delete.txt"));
    await writeFile(path.join(source, "new 'quoted'\nfile.txt"), "untracked\n");
    await writeFile(path.join(source, "run.sh"), "#!/bin/sh\nexit 0\n");
    await chmod(path.join(source, "run.sh"), 0o755);
    await writeFile(path.join(source, ".env"), "PRIVATE=not-uploaded");
    const beforeStatus = await git(source, ["status", "--porcelain=v1"]);
    const snapshot = await captureSnapshot(source, true);
    expect(contents(snapshot.encoded).files.map((file) => file.path)).not.toContain(".env");
    expect((await restore(snapshot)).stdout).toBe("GITTERM_HANDOFF_VERIFIED");
    expect(await git(cloud, ["rev-parse", "HEAD"])).toEqual(
      await git(source, ["rev-parse", "HEAD"]),
    );
    expect(await git(cloud, ["diff", ...DIFF_ARGS, "--cached", "HEAD", "--"])).toEqual(
      await git(source, ["diff", ...DIFF_ARGS, "--cached", "HEAD", "--"]),
    );
    expect(await git(cloud, ["diff", ...DIFF_ARGS, "--"])).toEqual(
      await git(source, ["diff", ...DIFF_ARGS, "--"]),
    );
    expect(await readFile(path.join(cloud, "image.bin"))).toEqual(
      await readFile(path.join(source, "image.bin")),
    );
    expect(await readFile(path.join(cloud, "unpublished.txt"), "utf8")).toContain("not on origin");
    expect(await readdir(cloud)).not.toContain(".env");
    expect(await readdir(cloud)).not.toContain(".gitterm-handoff-1234-abcd");
    expect(await git(source, ["status", "--porcelain=v1"])).toEqual(beforeStatus);
  });

  test("excluding changes still transfers unpublished HEAD, never dirty files", async () => {
    await writeFile(path.join(source, "hello.txt"), "local commit\n");
    await git(source, ["add", "hello.txt"]);
    await git(source, ["commit", "-m", "unpublished"]);
    await writeFile(path.join(source, "hello.txt"), "dirty\n");
    await writeFile(path.join(source, "untracked.txt"), "exclude\n");
    const snapshot = await captureSnapshot(source, false);
    expect(snapshot.changedPaths).toEqual([]);
    await restore(snapshot);
    expect(await readFile(path.join(cloud, "hello.txt"), "utf8")).toBe("local commit\n");
    expect((await git(cloud, ["status", "--porcelain=v1"])).length).toBe(0);
  });

  test("keeps staged changes even when unstaged edits return the file to HEAD", async () => {
    await writeFile(path.join(source, "hello.txt"), "staged\n");
    await git(source, ["add", "hello.txt"]);
    await writeFile(path.join(source, "hello.txt"), "initial\n");
    const snapshot = await captureSnapshot(source, true);
    expect(snapshot.changedPaths).toContain("hello.txt");
    await restore(snapshot);
  });

  test("preserves non-UTF-8 text patches byte-for-byte", async () => {
    await writeFile(path.join(source, "latin.txt"), Buffer.from([0x61, 0xe9, 0x0a]));
    await git(source, ["add", "latin.txt"]);
    await git(source, ["commit", "-m", "non-UTF-8 text"]);
    await writeFile(path.join(source, "latin.txt"), Buffer.from([0x62, 0xff, 0x0a]));
    await restore(await captureSnapshot(source, true));
    expect(await readFile(path.join(cloud, "latin.txt"))).toEqual(Buffer.from([0x62, 0xff, 0x0a]));
  });

  test("does not depend on the user's diff context or algorithm settings", async () => {
    await git(source, ["config", "diff.context", "0"]);
    await git(source, ["config", "diff.algorithm", "histogram"]);
    await writeFile(path.join(source, "hello.txt"), "custom diff settings\n");
    await restore(await captureSnapshot(source, true));
    expect(await readFile(path.join(cloud, "hello.txt"), "utf8")).toBe("custom diff settings\n");
  });

  test("rejects dirty destinations without overwriting them", async () => {
    await writeFile(path.join(cloud, "hello.txt"), "cloud work\n");
    await expect(restore(await captureSnapshot(source, true))).rejects.toThrow();
    expect(await readFile(path.join(cloud, "hello.txt"), "utf8")).toBe("cloud work\n");
  });

  test("detects restoration corruption", async () => {
    const snapshot = await captureSnapshot(source, true);
    const corrupt = tampered(snapshot, (inside) => {
      inside.digest = "bad";
    });
    await expect(restore(corrupt)).rejects.toThrow();
  });

  test("rejects path traversal in untracked files", async () => {
    const snapshot = await captureSnapshot(source, true);
    const escaping = tampered(snapshot, (inside) => {
      inside.files.push({ path: "../outside", data: Buffer.from("x"), executable: false });
    });
    await expect(restore(escaping)).rejects.toThrow();
    expect(await readdir(temporary)).not.toContain("outside");
  });

  test("does not follow a symlink parent while restoring an untracked file", async () => {
    const outside = path.join(temporary, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(source, "linked"));
    await git(source, ["add", "linked"]);
    await git(source, ["commit", "-m", "tracked symlink"]);
    const snapshot = await captureSnapshot(source, true);
    const escaping = tampered(snapshot, (inside) => {
      inside.files.push({ path: "linked/unsafe.txt", data: Buffer.from("x"), executable: false });
    });
    await expect(restore(escaping)).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });

  test("does not overwrite ignored destination secrets when switching commits", async () => {
    await mkdir(path.join(source, "ignored"));
    await writeFile(path.join(source, "ignored/config.txt"), "tracked source\n");
    await git(source, ["add", "-f", "ignored/config.txt"]);
    await git(source, ["commit", "-m", "new tracked file"]);
    await mkdir(path.join(cloud, "ignored"));
    await writeFile(path.join(cloud, "ignored/config.txt"), "destination secret\n");
    await expect(restore(await captureSnapshot(source, true))).rejects.toThrow();
    expect(await readFile(path.join(cloud, "ignored/config.txt"), "utf8")).toBe(
      "destination secret\n",
    );
  });

  test("rejects intent-to-add instead of losing its index state", async () => {
    await writeFile(path.join(source, "new.txt"), "new\n");
    await git(source, ["add", "-N", "new.txt"]);
    await expect(captureSnapshot(source, true)).rejects.toThrow("intent-to-add");
  });

  test("rejects suspicious secret paths and untracked symlinks before upload", async () => {
    await writeFile(path.join(source, "private.pem"), "sensitive");
    await expect(captureSnapshot(source, true)).rejects.toThrow("Potential secret");
    await rm(path.join(source, "private.pem"));
    await symlink(path.join(source, "hello.txt"), path.join(source, "link"));
    await expect(captureSnapshot(source, true)).rejects.toThrow("symlinks");
  });
});

describe("what a capture refuses", () => {
  // Assembled here so this file does not itself look like it holds a key.
  const key = ["-----BEGIN OPENSSH PRIVATE KEY-----", "b3BlbnNzaC1rZXktdjEAAAAABG5vbmU", ""].join(
    "\n",
  );

  test("private keys, in a tracked edit or an untracked file, only when the snapshot is uploaded", async () => {
    await writeFile(path.join(source, "hello.txt"), `config\n${key}`);
    await expect(captureSnapshot(source, true)).rejects.toThrow(
      "Private key material detected in changed files.",
    );
    await git(source, ["checkout", "--", "hello.txt"]);
    await writeFile(path.join(source, "notes.txt"), key);
    await expect(captureSnapshot(source, true)).rejects.toThrow(
      'Private key material detected in "notes.txt".',
    );
    // Leaving the changes out leaves the key out.
    expect((await captureSnapshot(source, false)).changedPaths).toEqual([]);

    // Coming back from the cloud nothing is screened: it is the user's own machine.
    const stage = ".gitterm-handoff-1234-abcd";
    await writeFile(path.join(cloud, ".env"), "TOKEN=from-the-cloud\n");
    await git(cloud, ["add", "-f", ".env"]);
    await execute("node", ["-e", PREPARE_STAGE_SCRIPT, stage], { cwd: cloud });
    const result = await execute(
      "node",
      ["-e", CAPTURE_SCRIPT, stage, JSON.stringify({ changes: true })],
      { cwd: cloud },
    );
    expect(result.stdout).toBe("GITTERM_CAPTURE_READY");
  });

  test("changes over the size limit, without reading them, and merge conflicts", async () => {
    await writeFile(path.join(source, "huge.bin"), Buffer.alloc(26 * 1024 * 1024));
    await expect(captureSnapshot(source, true)).rejects.toThrow(
      "Uncommitted changes exceed the 25 MiB handoff limit.",
    );
    await rm(path.join(source, "huge.bin"));

    await git(source, ["checkout", "-qb", "other"]);
    await writeFile(path.join(source, "hello.txt"), "other\n");
    await git(source, ["commit", "-qam", "other"]);
    await git(source, ["checkout", "-q", "main"]);
    await writeFile(path.join(source, "hello.txt"), "main\n");
    await git(source, ["commit", "-qam", "main"]);
    await git(source, ["merge", "other"]).catch(() => {});
    await expect(captureSnapshot(source, true)).rejects.toThrow("Resolve merge conflicts");
    // Nothing is left behind in the checkout by a refused capture.
    expect((await readdir(source)).filter((name) => name.startsWith(".gitterm"))).toEqual([]);
  });
});

describe("retrying in the same checkout", () => {
  const status = () => git(cloud, ["status", "--porcelain=v1", "--branch"]);

  test("uses the local branch name, or a generated one when HEAD is detached", async () => {
    await git(source, ["checkout", "-b", "feature/login"]);
    await writeFile(path.join(source, "login.txt"), "branch work\n");
    await git(source, ["add", "login.txt"]);
    await git(source, ["commit", "-m", "branch work"]);
    await restore(await captureSnapshot(source, false));
    expect((await git(cloud, ["symbolic-ref", "--short", "HEAD"])).toString().trim()).toBe(
      "feature/login",
    );

    await git(source, ["checkout", "--detach"]);
    await writeFile(path.join(source, "detached.txt"), "detached\n");
    await git(source, ["add", "detached.txt"]);
    await git(source, ["commit", "-m", "detached work"]);
    const detached = await captureSnapshot(source, false);
    expect(detached.branch).toBeNull();
    await restore(detached);
    expect((await git(cloud, ["symbolic-ref", "--short", "HEAD"])).toString().trim()).toBe(
      "gitterm/1234-abcd",
    );
  });

  test("a failed restore puts the checkout back, so the next attempt succeeds", async () => {
    await git(source, ["checkout", "-b", "feature/login"]);
    await writeFile(path.join(source, "hello.txt"), "edited\n");
    await writeFile(path.join(source, "new.txt"), "untracked\n");
    const before = { head: await git(cloud, ["rev-parse", "HEAD"]), status: await status() };
    const snapshot = await captureSnapshot(source, true);

    const corrupt = tampered(snapshot, (inside) => {
      inside.digest = "bad";
    });
    await expect(restore(corrupt)).rejects.toThrow();
    expect(await git(cloud, ["rev-parse", "HEAD"])).toEqual(before.head);
    expect(await status()).toEqual(before.status);
    expect((await git(cloud, ["branch", "--list", "feature/login"])).length).toBe(0);

    expect((await restore(snapshot)).stdout).toBe("GITTERM_HANDOFF_VERIFIED");
    expect(await readFile(path.join(cloud, "new.txt"), "utf8")).toBe("untracked\n");
  });

  test("recognises its own earlier restore, replaces it for a newer snapshot, and keeps cloud edits", async () => {
    await writeFile(path.join(source, "hello.txt"), "first\n");
    const first = await captureSnapshot(source, true);
    await restore(first);
    // The same snapshot again: nothing to do.
    expect((await restore(first)).stdout).toBe("GITTERM_HANDOFF_VERIFIED");

    // The local checkout moved on between attempts.
    await writeFile(path.join(source, "hello.txt"), "second\n");
    await writeFile(path.join(source, "extra.txt"), "more\n");
    const second = await captureSnapshot(source, true);
    expect((await restore(second)).stdout).toBe("GITTERM_HANDOFF_VERIFIED");
    expect(await readFile(path.join(cloud, "hello.txt"), "utf8")).toBe("second\n");

    // Work done in the cloud since then is never discarded.
    await writeFile(path.join(cloud, "hello.txt"), "cloud work\n");
    await writeFile(path.join(source, "hello.txt"), "third\n");
    await expect(restore(await captureSnapshot(source, true))).rejects.toThrow();
    expect(await readFile(path.join(cloud, "hello.txt"), "utf8")).toBe("cloud work\n");
  });

  test("never moves a branch past commits made only in the cloud", async () => {
    const commitInCloud = async (file: string) => {
      await writeFile(path.join(cloud, file), "cloud\n");
      await git(cloud, ["add", file]);
      await git(cloud, [
        "-c",
        "user.name=Cloud",
        "-c",
        "user.email=cloud@example.com",
        "commit",
        "-qm",
        file,
      ]);
      return git(cloud, ["rev-parse", "HEAD"]);
    };
    // Committed in the cloud after an earlier restore: the tree is clean but the work is new.
    await writeFile(path.join(source, "hello.txt"), "first\n");
    await restore(await captureSnapshot(source, true));
    await git(cloud, ["reset", "-q", "--hard"]);
    const committed = await commitInCloud("cloud.txt");
    await writeFile(path.join(source, "hello.txt"), "second\n");
    await expect(restore(await captureSnapshot(source, true))).rejects.toThrow();
    expect(await git(cloud, ["rev-parse", "main"])).toEqual(committed);

    // A clone with its own commits and no earlier restore.
    await rm(path.join(cloud, ".git", "gitterm-handoff.json"));
    await expect(restore(await captureSnapshot(source, true))).rejects.toThrow();
    expect(await git(cloud, ["rev-parse", "main"])).toEqual(committed);
  });

  test("a failed replacement puts the earlier restore back, staged, unstaged and untracked", async () => {
    await writeFile(path.join(source, "hello.txt"), "staged\n");
    await git(source, ["add", "hello.txt"]);
    await writeFile(path.join(source, "hello.txt"), "unstaged\n");
    await writeFile(path.join(source, "notes.txt"), "untracked\n");
    await restore(await captureSnapshot(source, true));
    const before = {
      staged: await git(cloud, ["diff", "--cached"]),
      unstaged: await git(cloud, ["diff"]),
      status: await status(),
    };

    await writeFile(path.join(source, "hello.txt"), "newer\n");
    const newer = await captureSnapshot(source, true);
    const corrupt = tampered(newer, (inside) => {
      inside.digest = "bad";
    });
    await expect(restore(corrupt)).rejects.toThrow();
    expect(await git(cloud, ["diff", "--cached"])).toEqual(before.staged);
    expect(await git(cloud, ["diff"])).toEqual(before.unstaged);
    expect(await status()).toEqual(before.status);
    expect(await readFile(path.join(cloud, "notes.txt"), "utf8")).toBe("untracked\n");
    expect((await git(cloud, ["stash", "list"])).length).toBe(0);

    // It is still recognised as the earlier restore, so the next attempt can replace it.
    expect((await restore(newer)).stdout).toBe("GITTERM_HANDOFF_VERIFIED");
    expect(await readFile(path.join(cloud, "hello.txt"), "utf8")).toBe("newer\n");
    expect((await git(cloud, ["stash", "list"])).length).toBe(0);
  });

  test("an upload directory left by a killed attempt does not block the next one", async () => {
    const stage = path.join(cloud, ".gitterm-handoff-1234-abcd");
    await mkdir(stage);
    await writeFile(path.join(stage, "snapshot.bin"), "half an upload");
    await writeFile(path.join(source, "hello.txt"), "edited\n");
    expect((await restore(await captureSnapshot(source, true))).stdout).toBe(
      "GITTERM_HANDOFF_VERIFIED",
    );
    expect(await readFile(path.join(cloud, "hello.txt"), "utf8")).toBe("edited\n");

    // A link planted under the name is replaced, and what it points at is left alone.
    const outside = path.join(temporary, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "keep.txt"), "keep\n");
    await symlink(outside, stage);
    await execute("node", ["-e", PREPARE_STAGE_SCRIPT, path.basename(stage)], { cwd: cloud });
    expect(await readdir(outside)).toEqual(["keep.txt"]);
    expect(await readdir(stage)).toEqual([]);
    await expect(
      execute("node", ["-e", PREPARE_STAGE_SCRIPT, "../outside"], { cwd: cloud }),
    ).rejects.toThrow();
    expect(await readdir(outside)).toEqual(["keep.txt"]);
  });

  test("creates the session's directory inside the checkout only", async () => {
    const snapshot = await captureSnapshot(source, false);
    const run = (subpath: string) => {
      const stage = ".gitterm-handoff-1234-abcd";
      return mkdir(path.join(cloud, stage))
        .then(() => writeFile(path.join(cloud, stage, "snapshot.bin"), snapshot.encoded))
        .then(() => execute("node", ["-e", RESTORE_SCRIPT, stage, subpath], { cwd: cloud }));
    };
    await run("packages/app");
    expect(await readdir(path.join(cloud, "packages"))).toEqual(["app"]);
    await expect(run("../outside")).rejects.toThrow();
    expect(await readdir(temporary)).not.toContain("outside");
  });
});

describe("commits already on origin", () => {
  /** Gives `source` an origin holding its current HEAD and makes `cloud` a fresh clone of it. */
  async function publish() {
    const origin = path.join(temporary, "origin.git");
    await git(temporary, ["clone", "--bare", source, origin]);
    await git(source, ["remote", "add", "origin", origin]);
    await git(source, ["fetch", "origin"]);
    await git(source, ["remote", "set-head", "origin", "main"]);
    await rm(cloud, { recursive: true, force: true });
    await git(temporary, ["clone", "--no-local", origin, cloud]);
    return origin;
  }
  const exitCode = (snapshot: CheckoutSnapshot) =>
    restore(snapshot).then(
      () => 0,
      (error: { code: number }) => error.code,
    );

  test("are not uploaded: a pushed HEAD sends no bundle, an unpushed one only its own commits", async () => {
    await publish();
    const pushed = await captureSnapshot(source, false);
    expect(contents(pushed.encoded).bundle.length).toBe(0);
    expect((await restore(pushed)).stdout).toBe("GITTERM_HANDOFF_VERIFIED");

    await writeFile(path.join(source, "big.bin"), Buffer.alloc(200_000, 7));
    await git(source, ["add", "big.bin"]);
    await git(source, ["commit", "-m", "pushed later"]);
    await git(source, ["push", "origin", "HEAD"]);
    await git(source, ["fetch", "origin"]);
    await writeFile(path.join(source, "local.txt"), "not on origin\n");
    await git(source, ["add", "local.txt"]);
    await git(source, ["commit", "-m", "local only"]);
    const unpushed = await captureSnapshot(source, false);
    const full = await captureSnapshot(source, false, true);
    expect(unpushed.bytes).toBeLessThan(full.bytes);
    expect(unpushed.digest).toBe(full.digest);

    await rm(cloud, { recursive: true, force: true });
    await git(temporary, ["clone", "--no-local", path.join(temporary, "origin.git"), cloud]);
    expect((await restore(unpushed)).stdout).toBe("GITTERM_HANDOFF_VERIFIED");
    expect(await readFile(path.join(cloud, "local.txt"), "utf8")).toBe("not on origin\n");
  });

  test("a clone missing the base asks for the full history and is left untouched", async () => {
    const origin = await publish();
    await writeFile(path.join(source, "local.txt"), "not on origin\n");
    await git(source, ["add", "local.txt"]);
    await git(source, ["commit", "-m", "local only"]);
    // Origin's history is replaced after the checkout last fetched it.
    const other = path.join(temporary, "other");
    await git(temporary, ["clone", origin, other]);
    await git(other, ["config", "user.name", "Test"]);
    await git(other, ["config", "user.email", "test@example.com"]);
    await git(other, ["commit", "--amend", "-m", "rewritten"]);
    await git(other, ["push", "--force", "origin", "HEAD"]);
    await rm(cloud, { recursive: true, force: true });
    await git(temporary, ["clone", "--no-local", origin, cloud]);
    const before = await git(cloud, ["rev-parse", "HEAD"]);

    expect(await exitCode(await captureSnapshot(source, false))).toBe(3);
    expect(await git(cloud, ["rev-parse", "HEAD"])).toEqual(before);
    expect((await git(cloud, ["status", "--porcelain=v1"])).length).toBe(0);
    expect((await restore(await captureSnapshot(source, false, true))).stdout).toBe(
      "GITTERM_HANDOFF_VERIFIED",
    );
  });
});

describe("coming back from the cloud", () => {
  const stage = ".gitterm-handoff-1234-abcd";
  const commit = (directory: string, message: string) =>
    git(directory, [
      "-c",
      "user.name=Cloud",
      "-c",
      "user.email=cloud@example.com",
      "commit",
      "-qm",
      message,
    ]);
  const look = async (directory: string) => ({
    head: (await git(directory, ["rev-parse", "HEAD"])).toString(),
    branch: (await git(directory, ["symbolic-ref", "--short", "HEAD"])).toString(),
    status: (await git(directory, ["status", "--porcelain=v1"])).toString(),
    staged: (await git(directory, ["diff", "--cached"])).toString(),
    unstaged: (await git(directory, ["diff"])).toString(),
  });
  /** Captures the cloud checkout the way a return does. */
  async function captureCloud(base: string) {
    await execute("node", ["-e", PREPARE_STAGE_SCRIPT, stage], { cwd: cloud });
    await execute("node", ["-e", CAPTURE_SCRIPT, stage, JSON.stringify({ base, changes: true })], {
      cwd: cloud,
    });
    const encoded = await readFile(path.join(cloud, stage, "snapshot.bin"));
    await rm(path.join(cloud, stage), { recursive: true });
    return encoded;
  }
  /** Applies it to the local checkout through this runtime, as the plugin does inside OpenCode. */
  async function bringBack(encoded: Buffer, expected: string, force = false) {
    await execute("node", ["-e", PREPARE_STAGE_SCRIPT, stage], { cwd: source });
    await writeFile(path.join(source, stage, "snapshot.bin"), encoded);
    return execute(
      process.execPath,
      ["-e", RESTORE_SCRIPT, stage, "", expected, force ? "force" : ""],
      {
        cwd: source,
        env: { ...process.env, BUN_BE_BUN: "1" },
      },
    );
  }
  /** Hands the local checkout off with its uncommitted changes, then works in the cloud. */
  async function handOffAndWorkInCloud() {
    await writeFile(path.join(source, "hello.txt"), "local edit\n");
    await writeFile(path.join(source, "draft.txt"), "local draft\n");
    const snapshot = await captureSnapshot(source, true);
    await restore(snapshot);
    await git(cloud, ["add", "hello.txt", "draft.txt"]);
    await commit(cloud, "cloud commit");
    await writeFile(path.join(cloud, "hello.txt"), "cloud staged\n");
    await git(cloud, ["add", "hello.txt"]);
    await writeFile(path.join(cloud, "hello.txt"), "cloud unstaged\n");
    await rm(path.join(cloud, "delete.txt"));
    await mkdir(path.join(cloud, "notes"));
    await writeFile(path.join(cloud, "notes", "plan.md"), "cloud notes\n");
    await chmod(path.join(cloud, "notes", "plan.md"), 0o755);
    return snapshot;
  }

  test("an untouched local checkout takes the cloud's commits and changes, keeping nothing aside", async () => {
    const snapshot = await handOffAndWorkInCloud();
    const encoded = await captureCloud(snapshot.head);
    const result = await bringBack(encoded, snapshot.state);
    expect(result.stdout).toBe('GITTERM_HANDOFF_VERIFIED {"stash":false,"branch":null}');
    expect(await look(source)).toEqual(await look(cloud));
    expect(await readFile(path.join(source, "notes", "plan.md"), "utf8")).toBe("cloud notes\n");
    expect((await stat(path.join(source, "notes", "plan.md"))).mode & 0o111).toBeTruthy();
    expect((await git(source, ["stash", "list"])).length).toBe(0);
    expect(await readdir(source)).not.toContain(stage);

    // Running it again (a retry after a later step failed) changes nothing.
    const again = await bringBack(encoded, snapshot.state);
    expect(again.stdout).toBe("GITTERM_HANDOFF_VERIFIED");
    expect(await look(source)).toEqual(await look(cloud));
  });

  test("local work done since the handoff is replaced only when forced, and is kept", async () => {
    const snapshot = await handOffAndWorkInCloud();
    await git(source, ["add", "draft.txt"]);
    await commit(source, "local commit after handoff");
    await writeFile(path.join(source, "hello.txt"), "edited after handoff\n");
    const before = await look(source);
    const encoded = await captureCloud(snapshot.head);

    await expect(bringBack(encoded, snapshot.state)).rejects.toMatchObject({
      code: RESTORE_NEEDS_CONFIRMATION,
    });
    expect(await look(source)).toEqual(before);

    const result = await bringBack(encoded, snapshot.state, true);
    expect(result.stdout).toBe(
      'GITTERM_HANDOFF_VERIFIED {"stash":true,"branch":"gitterm/before-return-1234-abcd"}',
    );
    expect(await look(source)).toEqual(await look(cloud));
    expect((await git(source, ["rev-parse", "gitterm/before-return-1234-abcd"])).toString()).toBe(
      before.head,
    );
    // The stash holds the edit made after the handoff.
    await git(source, ["reset", "-q", "--hard"]);
    await git(source, ["clean", "-fdq"]);
    await git(source, ["checkout", "-q", "gitterm/before-return-1234-abcd"]);
    await git(source, ["stash", "pop", "-q"]);
    expect(await readFile(path.join(source, "hello.txt"), "utf8")).toBe("edited after handoff\n");
  });

  test("a failed forced return puts the local work back", async () => {
    const snapshot = await handOffAndWorkInCloud();
    await writeFile(path.join(source, "hello.txt"), "edited after handoff\n");
    await writeFile(path.join(source, "mine.txt"), "untracked after handoff\n");
    const before = await look(source);
    const encoded = await captureCloud(snapshot.head);
    // Corrupt one byte of the last file, so verification fails after everything is applied.
    encoded[encoded.length - 2] = encoded[encoded.length - 2]! ^ 0xff;
    await expect(bringBack(encoded, snapshot.state, true)).rejects.toMatchObject({ code: 1 });
    expect(await look(source)).toEqual(before);
    expect(await readFile(path.join(source, "mine.txt"), "utf8")).toBe("untracked after handoff\n");
    expect((await git(source, ["stash", "list"])).length).toBe(0);
    expect((await git(source, ["branch", "--list", "gitterm/*"])).length).toBe(0);
  });

  test("only what the cloud added is captured, unless this machine lost the base", async () => {
    const snapshot = await handOffAndWorkInCloud();
    const thin = await captureCloud(snapshot.head);
    const full = await captureCloud("");
    expect(snapshotSummary(thin).digest).toBe(snapshotSummary(full).digest);
    expect(thin.length).toBeLessThan(full.length);

    // A base only the cloud has: the local checkout asks for everything, untouched.
    const cloudOnly = (await git(cloud, ["rev-parse", "HEAD"])).toString().trim();
    await writeFile(path.join(cloud, "more.txt"), "more\n");
    await git(cloud, ["add", "more.txt"]);
    await commit(cloud, "second cloud commit");
    const before = await look(source);
    await expect(bringBack(await captureCloud(cloudOnly), snapshot.state)).rejects.toMatchObject({
      code: RESTORE_NEEDS_FULL_HISTORY,
    });
    expect(await look(source)).toEqual(before);
    expect((await bringBack(await captureCloud(""), snapshot.state)).stdout).toContain(
      "GITTERM_HANDOFF_VERIFIED",
    );
    expect(await look(source)).toEqual(await look(cloud));
  });

  test("a cloud checkout that cannot be reproduced is refused and left alone", async () => {
    await symlink("hello.txt", path.join(cloud, "link"));
    await execute("node", ["-e", PREPARE_STAGE_SCRIPT, stage], { cwd: cloud });
    await expect(
      execute("node", ["-e", CAPTURE_SCRIPT, stage, JSON.stringify({ changes: true })], {
        cwd: cloud,
      }),
    ).rejects.toMatchObject({ code: CAPTURE_UNSUPPORTED });
    expect(await readdir(cloud)).not.toContain(stage);
  });
});

describe("a checkout without an origin", () => {
  // The cloud workspace for it has no clone: an empty directory the restore makes a repository.
  beforeEach(async () => {
    await rm(cloud, { recursive: true, force: true });
    await mkdir(cloud);
  });

  test("goes up with its whole history into an empty directory, changes included", async () => {
    expect(await repositoryUrl(source)).toBeUndefined();
    await git(source, ["checkout", "-b", "feature"]);
    await writeFile(path.join(source, "hello.txt"), "second\n");
    await git(source, ["commit", "-am", "second"]);
    await writeFile(path.join(source, "hello.txt"), "uncommitted\n");
    await writeFile(path.join(source, "new.txt"), "untracked\n");
    const snapshot = await captureSnapshot(source, true, true);
    expect((await restore(snapshot)).stdout).toBe("GITTERM_HANDOFF_VERIFIED");
    expect((await git(cloud, ["rev-parse", "HEAD", "HEAD~1"])).toString()).toBe(
      (await git(source, ["rev-parse", "HEAD", "HEAD~1"])).toString(),
    );
    expect((await git(cloud, ["symbolic-ref", "--short", "HEAD"])).toString().trim()).toBe(
      "feature",
    );
    expect(await readFile(path.join(cloud, "hello.txt"), "utf8")).toBe("uncommitted\n");
    expect(await readFile(path.join(cloud, "new.txt"), "utf8")).toBe("untracked\n");
    // A retry of the same snapshot recognises its own restore.
    expect((await restore(snapshot)).stdout).toBe("GITTERM_HANDOFF_VERIFIED");
  });

  test("a failed first restore leaves the directory empty for the next attempt", async () => {
    const snapshot = await captureSnapshot(source, false, true);
    const corrupt = tampered(snapshot, (inside) => {
      inside.digest = "bad";
    });
    await expect(restore(corrupt)).rejects.toThrow();
    expect(await readdir(cloud)).toEqual([]);
    expect((await restore(snapshot)).stdout).toBe("GITTERM_HANDOFF_VERIFIED");
  });

  test("never restores over files already in the directory", async () => {
    await writeFile(path.join(cloud, "notes.txt"), "cloud work\n");
    const snapshot = await captureSnapshot(source, false, true);
    await expect(restore(snapshot)).rejects.toThrow();
    expect(await readdir(cloud)).toEqual(["notes.txt"]);
    // Nor over a repository someone made there and worked in without committing.
    await git(cloud, ["init", "-q"]);
    await expect(restore(snapshot)).rejects.toThrow();
    expect(await readFile(path.join(cloud, "notes.txt"), "utf8")).toBe("cloud work\n");
  });

  test("a repository without commits is refused before anything is uploaded", async () => {
    const empty = path.join(temporary, "empty");
    await mkdir(empty);
    await git(empty, ["init", "-q"]);
    await expect(captureSnapshot(empty, true, true)).rejects.toThrow("Commit at least once");
  });
});

describe("checkout identity and origin", () => {
  test("matches subdirectory sessions but not other worktrees", async () => {
    await mkdir(path.join(source, "nested"));
    const worktree = path.join(temporary, "worktree");
    await git(source, ["worktree", "add", "-b", "isolated", worktree]);
    const root = await checkoutRoot(source);
    expect(
      await sharedCheckoutSessions(root, "current", [
        { id: "current", location: { directory: source } },
        { id: "shared", location: { directory: path.join(source, "nested") } },
        { id: "isolated", location: { directory: worktree } },
        { id: "missing", location: { directory: path.join(temporary, "missing") } },
      ]),
    ).toEqual(["shared"]);
  });

  test("normalizes GitHub SSH origins but rejects embedded credentials and local paths", async () => {
    await git(source, ["remote", "add", "origin", "git@github.com:example/repo.git"]);
    expect(await repositoryUrl(source)).toBe("https://github.com/example/repo.git");
    await git(source, ["remote", "set-url", "origin", "https://token@github.com/example/repo.git"]);
    await expect(repositoryUrl(source)).rejects.toThrow("credential-free");
    await git(source, ["remote", "set-url", "origin", cloud]);
    await expect(repositoryUrl(source)).rejects.toThrow("HTTPS origin");
  });

  test("treats environment files as secrets but allows their templates", () => {
    expect(sensitivePath(".env.production")).toBe(true);
    expect(sensitivePath(".env.example")).toBe(false);
    expect(sensitivePath(".env.selfhost.example")).toBe(false);
    expect(sensitivePath(".env.production.local")).toBe(true);
  });
});
