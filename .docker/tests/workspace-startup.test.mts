import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "gitterm-startup-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const files = [
  "opencode/entrypoint.sh",
  "opencode/server.entrypoint.sh",
  "t3code/server.entrypoint.sh",
];

for (const [index, file] of files.entries()) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  test(`${file}: shallow clone, exact commit, ownership retry and file preservation`, () => {
    const dir = join(root, String(index));
    mkdirSync(dir);
    const home = join(dir, "home");
    mkdirSync(home);
    const origin = join(dir, "origin");
    const git = (...args: string[]) =>
      execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "-b", "main", origin);
    git(
      "-C",
      origin,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "first",
    );
    const commit = git("-C", origin, "rev-parse", "HEAD");
    git(
      "-C",
      origin,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "second",
    );
    const timing = source
      .split("# STARTUP TIMING")[1]!
      .split("# REPOSITORY TRUST (also needed when resuming on EFS)")[0]!;
    const trust = source
      .split("# REPOSITORY TRUST (also needed when resuming on EFS)")[1]!
      .split("# FIRST-TIME SETUP")[0]!
      .replaceAll("/workspace/", `${dir}/`);
    const clone = source
      .split("# Prefer named checkout ref, then branch, for the initial clone.")[1]!
      .split('        echo "$REPO_OWNER" > .repo_owner')[0]!;
    const options = {
      cwd: dir,
      env: {
        ...process.env,
        HOME: home,
        GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
        REPO_NAME: "repo",
        REPO_URL: `file://${origin}`,
        REPO_BRANCH: "main",
        REPO_BASE_COMMIT: commit,
      },
      encoding: "utf8" as const,
    };
    const script = `set -e\n${timing}\n${trust}\n${clone}`;
    const output = execFileSync("sh", ["-c", script], options);
    expect(output).toMatch(/\[gitterm-startup\] stage=clone durationSeconds=\d+/);
    expect(output).toMatch(/\[gitterm-startup\] stage=checkout durationSeconds=\d+/);
    expect(git("-C", join(dir, "repo"), "rev-parse", "HEAD")).toBe(commit);
    expect(git("-C", join(dir, "repo"), "rev-parse", "--is-shallow-repository")).toBe("true");
    writeFileSync(join(dir, "repo", "user-work.txt"), "keep");
    execFileSync("sh", ["-c", script], {
      ...options,
      env: { ...options.env, GIT_TEST_ASSUME_DIFFERENT_OWNER: "1" },
    });
    expect(readFileSync(join(dir, "repo", "user-work.txt"), "utf8")).toBe("keep");
    expect(() =>
      execFileSync("sh", ["-c", script], {
        ...options,
        env: { ...options.env, REPO_URL: "https://example.com/different" },
        stdio: "pipe",
      }),
    ).toThrow();
  });

  test(`${file}: configures the shared GitHub credential helper`, () => {
    expect(source).toContain(
      "git config --global credential.helper /usr/local/bin/gitterm-git-credential",
    );
  });
}

test("GitHub credential helper refreshes expired credentials and reuses its cache", () => {
  const dir = join(root, "token");
  mkdirSync(dir);
  const code = readFileSync(new URL("../git-credential-github.mjs", import.meta.url), "utf8")
    .replace(/^#!.*\n/, "")
    .replaceAll("/run/gitterm", dir);
  writeFileSync(join(dir, "github-token"), "expired-token");
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const options = {
    env: {
      ...process.env,
      GITHUB_APP_TOKEN_EXPIRY: "2000-01-01",
      WORKSPACE_API_URL: "https://api.example.com/trpc",
      WORKSPACE_AUTH_TOKEN: "scoped-token",
    },
    encoding: "utf8" as const,
  };
  const mockFetch = `globalThis.fetch = async (url, options) => {
    if (url !== "https://api.example.com/trpc/workspaceOps.gitCredential" || options.headers.Authorization !== "Bearer scoped-token") throw new Error("wrong request");
    return { ok: true, json: async () => ({ result: { data: { token: "fresh-token", expiresAt: "${expiresAt}" } } }) };
  };`;
  expect(execFileSync("node", ["-e", mockFetch + code, "helper", "get"], options)).toContain(
    "password=fresh-token",
  );
  expect(
    execFileSync(
      "node",
      [
        "-e",
        'globalThis.fetch = async () => { throw new Error("must use cache"); };' + code,
        "helper",
        "get",
      ],
      options,
    ),
  ).toContain("password=fresh-token");
  writeFileSync(join(dir, "github-token.expiry"), "2000-01-01");
  expect(() =>
    execFileSync(
      "node",
      ["-e", "globalThis.fetch = async () => ({ ok: false });" + code, "helper", "get"],
      { ...options, stdio: "pipe" },
    ),
  ).toThrow();
});

test("only the AWS variant ships the AWS CLI; base images stay lean", () => {
  const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const aws = read("Opencode.Server.AWS.Dockerfile");
  expect(aws).toContain("awscli-exe-linux-${aws_arch}.zip");
  expect(aws).toContain("--install-dir /usr/local/aws-cli --bin-dir /usr/local/bin");
  expect(aws).toContain('CMD ["opencode", "serve", "--port", "7681", "--hostname", "[::]"]');
  for (const file of [
    "Opencode.Server.Dockerfile",
    "T3Code.Server.Dockerfile",
    "Opencode.Dockerfile",
  ])
    expect(read(file)).not.toContain("awscli");
});

test("workspace images install the shared GitHub credential helper", () => {
  for (const file of [
    "Opencode.Server.AWS.Dockerfile",
    "Opencode.Server.Dockerfile",
    "T3Code.Server.Dockerfile",
    "Opencode.Dockerfile",
  ]) {
    const dockerfile = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    expect(dockerfile).toContain(
      "COPY ./git-credential-github.mjs /usr/local/bin/gitterm-git-credential",
    );
  }
});

test("workspace images leave GitHub CLI installation to the agent", () => {
  for (const file of [
    "Opencode.Server.AWS.Dockerfile",
    "Opencode.Server.Dockerfile",
    "T3Code.Server.Dockerfile",
    "Opencode.Dockerfile",
  ]) {
    const dockerfile = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    expect(dockerfile).not.toContain("/usr/local/bin/gh");
    expect(dockerfile).not.toMatch(/apt-get install[^;]*\bgh\b/s);
  }
});

test("blocking setup phase reports its duration and propagates the exit code", () => {
  const dir = join(root, "runner");
  mkdirSync(dir);
  const runner = new URL("../workspace-setup-runner.sh", import.meta.url).pathname;
  const env = (command: string) => ({
    ...process.env,
    WORKSPACE_BEFORE_AGENT_COMMAND_BASE64: Buffer.from(command).toString("base64"),
    GITTERM_WORKSPACE_SETUP_STRICT: "1",
    WORKSPACE_SETUP_DELAY_SECONDS: "5",
  });
  const started = Date.now();
  const output = execFileSync(
    "sh",
    ["-c", `sed 's#/run/gitterm#${dir}#' ${runner} | sh -s ${dir} before-agent`],
    {
      env: env("echo hello"),
      encoding: "utf8",
    },
  );
  expect(Date.now() - started).toBeLessThan(4_000); // no sleep on the blocking path
  expect(output).toContain("[gitterm-startup] before-agent setup started");
  expect(output).toMatch(/before-agent setup finished exitCode=0 durationSeconds=\d+/);
  expect(() =>
    execFileSync(
      "sh",
      ["-c", `sed 's#/run/gitterm#${dir}#' ${runner} | sh -s ${dir} before-agent`],
      {
        env: env("exit 3"),
        stdio: "pipe",
      },
    ),
  ).toThrow();
});
