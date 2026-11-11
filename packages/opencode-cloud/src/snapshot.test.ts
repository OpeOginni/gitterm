import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  captureSnapshot,
  checkoutRoot,
  DIFF_ARGS,
  encodeSnapshot,
  git,
  repositoryUrl,
  safeRelativePath,
  sensitivePath,
  sharedCheckoutSessions,
  type CheckoutSnapshot,
} from "./snapshot";
import { PREPARE_STAGE_SCRIPT, RESTORE_SCRIPT } from "./restore";

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

async function restore(snapshot: CheckoutSnapshot) {
  const stage = ".gitterm-handoff-1234-abcd";
  await execute("node", ["-e", PREPARE_STAGE_SCRIPT, stage], { cwd: cloud });
  await writeFile(path.join(cloud, stage, "snapshot.bin"), encodeSnapshot(snapshot));
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
    expect(snapshot.files.map((file) => file.path)).not.toContain(".env");
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
    snapshot.digest = "bad";
    await expect(restore(snapshot)).rejects.toThrow();
  });

  test("rejects path traversal in untracked files", async () => {
    const snapshot = await captureSnapshot(source, true);
    snapshot.files.push({ path: "../outside", data: "eA==", executable: false });
    await expect(restore(snapshot)).rejects.toThrow();
    expect(await readdir(temporary)).not.toContain("outside");
  });

  test("does not follow a symlink parent while restoring an untracked file", async () => {
    const outside = path.join(temporary, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(source, "linked"));
    await git(source, ["add", "linked"]);
    await git(source, ["commit", "-m", "tracked symlink"]);
    const snapshot = await captureSnapshot(source, true);
    snapshot.files.push({ path: "linked/unsafe.txt", data: "eA==", executable: false });
    await expect(restore(snapshot)).rejects.toThrow();
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

    await expect(restore({ ...snapshot, digest: "bad" })).rejects.toThrow();
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
    await expect(restore({ ...newer, digest: "bad" })).rejects.toThrow();
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
        .then(() => writeFile(path.join(cloud, stage, "snapshot.bin"), encodeSnapshot(snapshot)))
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
    expect(pushed.bundle).toBe("");
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

  test("validates transfer paths and allows environment templates", () => {
    for (const name of ["../x", "/absolute", "a/.git/config", "a\\b", "a/../b"])
      expect(safeRelativePath(name)).toBe(false);
    expect(safeRelativePath("a/normal.txt")).toBe(true);
    expect(sensitivePath(".env.production")).toBe(true);
    expect(sensitivePath(".env.example")).toBe(false);
    expect(sensitivePath(".env.selfhost.example")).toBe(false);
    expect(sensitivePath(".env.production.local")).toBe(true);
  });
});
