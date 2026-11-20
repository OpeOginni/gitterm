import { afterAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SandboxBackend } from "./backend";
import { captureSource, uploadSource } from "./source";

const work = await mkdtemp(path.join(tmpdir(), "gitterm-git-sync-"));
afterAll(() => rm(work, { recursive: true, force: true }));
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    stdio: "pipe",
  })
    .toString()
    .trim();

// "GitHub": a local repository with one pushed commit, holding a file sync never sends.
const origin = path.join(work, "origin.git");
const seed = path.join(work, "seed");
await mkdir(seed);
git(seed, "init", "-q", "-b", "main");
await writeFile(path.join(seed, "a.txt"), "pushed\n");
await writeFile(path.join(seed, "keep.txt"), "pushed\n");
await writeFile(path.join(seed, "big.bin"), Buffer.alloc(200_000, 7));
await writeFile(path.join(seed, ".env"), "SECRET=committed-by-mistake\n");
git(seed, "add", "-A");
git(seed, "commit", "-qm", "base");
git(work, "clone", "-q", "--bare", seed, origin);
git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");

// The local checkout: one unpushed commit, an edit, a deletion, and an untracked file.
const repo = path.join(work, "repo");
git(work, "clone", "-q", origin, repo);
git(repo, "remote", "set-url", "origin", "git@github.com:owner/repo.git");
await writeFile(path.join(repo, "a.txt"), "local edit\n");
await writeFile(path.join(repo, "committed.txt"), "unpushed\n");
git(repo, "add", "committed.txt");
git(repo, "commit", "-qm", "local");
await rm(path.join(repo, "keep.txt"));
await writeFile(path.join(repo, "new.txt"), "untracked\n");

/** A sandbox on this machine. `github` is where the sandbox's GitHub URLs lead. */
function localBackend(github: string) {
  const home = path.join(work, `home-${Math.random().toString(16).slice(2)}`);
  const gitconfig = path.join(work, `gitconfig-${path.basename(home)}`);
  const uploads: number[] = [];
  const backend = {
    identity: { mode: "direct", provider: "e2b", account: "test" },
    home,
    async run(_id: string, command: string) {
      await writeFile(
        gitconfig,
        `[url "${github}"]\n\tinsteadOf = https://github.com/owner/repo.git\n`,
      );
      const result = spawnSync("bash", ["-c", command], {
        env: { ...process.env, GIT_CONFIG_GLOBAL: gitconfig },
      });
      return {
        exitCode: result.status ?? 1,
        stdout: `${result.stdout}`,
        stderr: `${result.stderr}`,
      };
    },
    async writeFile(_id: string, file: string, data: Uint8Array) {
      if (file.endsWith(".tgz")) uploads.push(data.byteLength);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    },
  } as unknown as SandboxBackend;
  return { backend, home, uploads };
}

const tarNames = (archive: Buffer) =>
  execFileSync("tar", ["-tz"], { input: archive }).toString().trim().split("\n");

async function projectFiles(home: string) {
  const dir = path.join(home, "project");
  return Object.fromEntries(
    await Promise.all(
      (await readdir(dir))
        .toSorted()
        .map(async (name) => [name, await readFile(path.join(dir, name), "utf8")]),
    ),
  );
}

test("a GitHub checkout uploads only what differs from its pushed commit", async () => {
  const captured = await captureSource(repo);
  expect(captured.git?.repo).toBe("owner/repo");
  expect(captured.git?.commit).toBe(git(repo, "rev-parse", "origin/main"));
  expect(tarNames(captured.git!.archive).toSorted()).toEqual(["a.txt", "committed.txt", "new.txt"]);

  const { backend, home, uploads } = localBackend(origin);
  expect(await uploadSource(backend, "sbx", captured)).toEqual({
    verified: true,
    digest: captured.snapshot.digest,
  });
  expect(uploads).toEqual([captured.git!.archive.byteLength]);
  const files = await projectFiles(home);
  // keep.txt was deleted locally and .env is never synced, though the commit has both.
  expect(Object.keys(files)).toEqual(["a.txt", "big.bin", "committed.txt", "new.txt"]);
  expect(files["a.txt"]).toBe("local edit\n");
  expect((await readdir(path.join(home, ".gitterm/source"))).toSorted()).toEqual([
    "current.digest",
    "current.files",
  ]);
});

test("when the sandbox cannot fetch the commit, everything is uploaded, and later syncs skip the fetch", async () => {
  const captured = await captureSource(repo);
  const { backend, home, uploads } = localBackend(path.join(work, "missing.git"));
  expect((await uploadSource(backend, "unfetchable", captured)).verified).toBe(true);
  expect(uploads).toEqual([captured.git!.archive.byteLength, captured.archive.byteLength]);
  expect(Object.keys(await projectFiles(home))).toEqual([
    "a.txt",
    "big.bin",
    "committed.txt",
    "new.txt",
  ]);
  await uploadSource(backend, "unfetchable", captured);
  expect(uploads).toHaveLength(3);
});

test("a checkout whose origin is not on GitHub uploads everything", async () => {
  const other = path.join(work, "other");
  git(work, "clone", "-q", origin, other);
  expect((await captureSource(other)).git).toBeUndefined();
});
