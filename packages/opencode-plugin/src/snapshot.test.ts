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
  git,
  repositoryUrl,
  safeRelativePath,
  sensitivePath,
  sharedCheckoutSessions,
  type CheckoutSnapshot,
} from "./snapshot";
import { RESTORE_SCRIPT } from "./restore";

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
  await mkdir(path.join(cloud, stage));
  await writeFile(path.join(cloud, stage, "snapshot.json"), JSON.stringify(snapshot));
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
  });
});
