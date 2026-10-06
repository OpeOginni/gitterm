import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildGitCommitIdentityCommand,
  githubCommitIdentity,
  resolveGitCommitIdentity,
} from "./git-commit-identity";

const author = githubCommitIdentity({ id: 123, login: "octocat", name: "Octo Cat" });
const bot = githubCommitIdentity({ id: 248179953, login: "gitterm-dev[bot]" });

describe("commit attribution", () => {
  test("uses the real GitHub ID/login, not the display name or app ID", () => {
    expect(author).toEqual({ name: "Octo Cat", email: "123+octocat@users.noreply.github.com" });
    expect(bot.email).toBe("248179953+gitterm-dev[bot]@users.noreply.github.com");
  });

  test("defaults to user authorship and GitTerm committer", () => {
    expect(resolveGitCommitIdentity(author)).toEqual({
      author,
      committer: { name: "GitTerm", email: "noreply@gitterm.dev" },
    });
    expect(resolveGitCommitIdentity(author, true, bot)).toEqual({ author, committer: bot });
    expect(resolveGitCommitIdentity(author, false, bot)).toEqual({ author, committer: author });
  });

  test.each([
    { id: 0, login: "octocat" },
    { id: 1.5, login: "octocat" },
    { id: 123, login: "Octo Cat" },
    { id: 123, login: "x\ncommitter" },
  ])("rejects malformed GitHub identities: %j", (profile) => {
    expect(() => githubCommitIdentity(profile)).toThrow("Invalid GitHub commit identity");
  });

  test("real commits retain user authorship, support opting out, and leave history alone", () => {
    const directory = mkdtempSync(join(tmpdir(), "gitterm-commit-identity-"));
    const env: Record<string, string | undefined> = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(directory, "global.gitconfig"),
    };
    for (const key of [
      "GIT_AUTHOR_NAME",
      "GIT_AUTHOR_EMAIL",
      "GIT_COMMITTER_NAME",
      "GIT_COMMITTER_EMAIL",
      "GIT_CONFIG_COUNT",
    ]) {
      delete env[key];
    }
    const run = (cmd: string[]) => {
      const result = Bun.spawnSync(cmd, { cwd: directory, env, stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      return result.stdout.toString().trim();
    };
    const configure = (showGitTerm: boolean) =>
      run([
        "sh",
        "-c",
        buildGitCommitIdentityCommand(resolveGitCommitIdentity(author, showGitTerm, bot)),
      ]);
    try {
      run(["git", "init", "--quiet"]);
      // Explicit stale overrides must not survive the account preference.
      run(["git", "config", "author.email", "wrong@example.com"]);
      run(["git", "config", "committer.email", "wrong@example.com"]);
      configure(true);
      run(["git", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Branded commit"]);
      const branded = run(["git", "rev-parse", "HEAD"]);
      const attribution = "%an|%ae|%cn|%ce";
      const expected = `${author.name}|${author.email}|${bot.name}|${bot.email}`;
      expect(run(["git", "log", "-1", `--format=${attribution}`])).toBe(expected);

      configure(false);
      run([
        "git",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-m",
        "Unbranded commit",
      ]);
      expect(run(["git", "log", "-1", `--format=${attribution}`])).toBe(
        `${author.name}|${author.email}|${author.name}|${author.email}`,
      );
      expect(run(["git", "show", "-s", `--format=${attribution}`, branded])).toBe(expected);

      // Also set defaults for additional repos created by an agent.
      expect(run(["git", "config", "--global", "committer.email"])).toBe(author.email);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("quotes identity values safely and works without a checked-out repo", () => {
    const directory = mkdtempSync(join(tmpdir(), "gitterm-commit-quote-"));
    const name = "Ope '$(touch injected)'";
    const identity = resolveGitCommitIdentity({ name, email: "ope@example.com" }, false);
    const env = { ...process.env, GIT_CONFIG_GLOBAL: join(directory, "global.gitconfig") };
    try {
      const result = Bun.spawnSync(["sh", "-c", buildGitCommitIdentityCommand(identity)], {
        cwd: directory,
        env,
      });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(existsSync(join(directory, "injected"))).toBe(false);
      const config = Bun.spawnSync(["git", "config", "--global", "user.name"], {
        cwd: directory,
        env,
      });
      expect(config.stdout.toString().trim()).toBe(name);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("failed identity setup cannot be masked by a subsequent setup command", () => {
    const result = Bun.spawnSync(
      [
        "sh",
        "-c",
        `${buildGitCommitIdentityCommand(resolveGitCommitIdentity(author))}\necho should-not-run`,
      ],
      {
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null/nonexistent" },
      },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).not.toContain("should-not-run");
  });
});
