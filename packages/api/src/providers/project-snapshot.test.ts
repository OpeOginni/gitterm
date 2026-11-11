import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkspaceRepoProvisioning } from "./compute";
import {
  gitCredentialPrefix,
  SCRUB_WORKSPACE_COMMAND,
  repositoryCheckoutCommand,
} from "./project-snapshot";

const execute = promisify(execFile);
let root: string;
let origin: string;
let machine: string;
const git = (directory: string, ...args: string[]) =>
  execute("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory,
  }).then((result) => result.stdout.trim());
const repo = (overrides: Partial<WorkspaceRepoProvisioning> = {}) =>
  ({ url: origin, name: "repo", ...overrides }) as WorkspaceRepoProvisioning;
/** Runs the checkout script in the machine's repository directory, as a provider does. */
const checkout = (overrides?: Partial<WorkspaceRepoProvisioning>) =>
  execute("bash", ["-c", repositoryCheckoutCommand(repo(overrides), origin)], { cwd: machine });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gitterm-project-snapshot-"));
  origin = path.join(root, "origin");
  machine = path.join(root, "machine");
  await mkdir(origin);
  await git(origin, "init", "-q", "-b", "main");
  await writeFile(path.join(origin, "app.txt"), "one\n");
  await writeFile(path.join(origin, ".gitignore"), "node_modules/\n");
  await git(origin, "add", ".");
  await git(origin, "commit", "-qm", "one");
  await mkdir(machine);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("a fresh machine gets a clone", async () => {
  await checkout();
  expect(await readFile(path.join(machine, "app.txt"), "utf8")).toBe("one\n");
  expect(await git(machine, "symbolic-ref", "--short", "HEAD")).toBe("main");
});

test("a machine started from a snapshot is brought to a fresh clone's state, keeping ignored files", async () => {
  await checkout();
  // What an earlier workspace left behind: its own branch and commit, edits, untracked
  // files, installed dependencies and the handoff's bookkeeping.
  await git(machine, "checkout", "-q", "-b", "feature/old");
  await writeFile(path.join(machine, "app.txt"), "old work\n");
  await git(machine, "commit", "-qam", "old work");
  await writeFile(path.join(machine, "app.txt"), "uncommitted\n");
  await writeFile(path.join(machine, "scratch.txt"), "untracked\n");
  await mkdir(path.join(machine, "node_modules"));
  await writeFile(path.join(machine, "node_modules", "dep.js"), "installed\n");
  await writeFile(path.join(machine, ".git", "gitterm-handoff.json"), "{}");
  // Meanwhile origin moved on.
  await writeFile(path.join(origin, "app.txt"), "two\n");
  await git(origin, "commit", "-qam", "two");

  await checkout();
  expect(await git(machine, "symbolic-ref", "--short", "HEAD")).toBe("main");
  expect(await git(machine, "rev-parse", "HEAD")).toBe(await git(origin, "rev-parse", "HEAD"));
  expect(await git(machine, "status", "--porcelain")).toBe("");
  expect(await readFile(path.join(machine, "app.txt"), "utf8")).toBe("two\n");
  expect(await readdir(machine)).not.toContain("scratch.txt");
  expect(await readFile(path.join(machine, "node_modules", "dep.js"), "utf8")).toBe("installed\n");
  expect(await readdir(path.join(machine, ".git"))).not.toContain("gitterm-handoff.json");
});

test("a requested branch or tag is checked out from the refreshed clone", async () => {
  await git(origin, "checkout", "-q", "-b", "release");
  await writeFile(path.join(origin, "app.txt"), "release\n");
  await git(origin, "commit", "-qam", "release");
  await git(origin, "tag", "v1");
  await git(origin, "checkout", "-q", "main");
  await checkout();

  await checkout({ branch: "release" });
  expect(await git(machine, "symbolic-ref", "--short", "HEAD")).toBe("release");
  expect(await readFile(path.join(machine, "app.txt"), "utf8")).toBe("release\n");

  await checkout({ checkoutRef: "v1" });
  expect(await git(machine, "rev-parse", "HEAD")).toBe(await git(origin, "rev-parse", "v1"));
});

test("a refresh that cannot reach the repository fails instead of leaving stale code", async () => {
  await checkout();
  await rm(origin, { recursive: true, force: true });
  await expect(checkout()).rejects.toThrow();
});

test("the credential prefix lets one command authenticate without configuring the machine", async () => {
  expect(gitCredentialPrefix(repo())).toBe("");
  const prefix = gitCredentialPrefix(repo({ authToken: "tok'en", authUsername: "x-access-token" }));
  const { stdout } = await execute("bash", [
    "-c",
    `${prefix}bash -c 'printf "protocol=https\\nhost=example.com\\n\\n" | git credential fill'`,
  ]);
  expect(stdout).toContain("username=x-access-token");
  expect(stdout).toContain("password=tok'en");
});

test("preparing a workspace for a snapshot removes credentials and the agent's data", async () => {
  const home = path.join(root, "home");
  const files = [
    ".gitterm/opencode/credentials.json",
    ".gitterm/github/config.json",
    ".local/state/opencode/service.json",
    ".local/share/opencode/sessions.db",
  ];
  for (const file of [...files, "project/keep.txt"]) {
    await mkdir(path.dirname(path.join(home, file)), { recursive: true });
    await writeFile(path.join(home, file), "x");
  }
  // Only the scrub: the full command also stops the agent, which on a developer's machine
  // would stop their own OpenCode. Its own HOME and Git config keep it away from theirs.
  await execute("bash", ["-c", SCRUB_WORKSPACE_COMMAND], {
    env: {
      PATH: process.env.PATH,
      HOME: home,
      GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
    } as unknown as NodeJS.ProcessEnv,
  });
  for (const file of files)
    expect(await readFile(path.join(home, file), "utf8").catch(() => "gone")).toBe("gone");
  expect(await readFile(path.join(home, "project/keep.txt"), "utf8")).toBe("x");
});
