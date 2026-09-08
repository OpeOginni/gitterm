import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { githubAuthProvisioning, githubAuthCommand } from "./github-auth";

const homes: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function fixture(renewable = false, expiresAt?: string) {
  const home = mkdtempSync(join(tmpdir(), "gitterm-github-test-"));
  homes.push(home);
  const provision = githubAuthProvisioning({
    url: "https://github.com/acme/project",
    authToken: "initial-token",
    inlineAuth: !renewable,
    authExpiresAt: expiresAt,
  })!;
  for (const file of provision.files) {
    const target = file.path.replace("~", home);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, Buffer.from(file.contentBase64, "base64"), { mode: file.mode });
  }
  const realBin = join(home, "real-bin");
  mkdirSync(realBin);
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${home}/.gitterm/bin:${realBin}:${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    GH_HOST: "",
    GH_REPO: "",
    WORKSPACE_API_URL: "",
    WORKSPACE_AUTH_TOKEN: "",
  };
  const runtime = join(home, ".gitterm/github/runtime.cjs");
  async function run(args: string[], input = "", overrides: Record<string, string> = {}) {
    const child = Bun.spawn([Bun.which("node")!, runtime, ...args], {
      cwd: home,
      env: { ...env, ...overrides },
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, code };
  }
  function install() {
    writeFileSync(
      join(realBin, "gh"),
      `#!/usr/bin/env node
console.log(JSON.stringify({token: process.env.GH_TOKEN, args: process.argv.slice(2)}));
process.exitCode = Number(process.env.FAKE_GH_EXIT || 0);
`,
      { mode: 0o700 },
    );
  }
  return { home, env, run, install, provision };
}

test("PAT authenticates gh and Git without exposing it in profiles or command arguments", async () => {
  const f = fixture();
  execFileSync(
    "git",
    ["config", "--global", "credential.helper", "/run/gitterm/git-credential-helper.sh"],
    { env: f.env },
  );
  execFileSync("git", ["config", "--global", "--add", "credential.helper", "user-owned-helper"], {
    env: f.env,
  });
  expect((await f.run(["setup"])).code).toBe(0);
  f.install();
  const result = await f.run(["gh", "pr", "list", "--repo", "acme/project"]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    token: "initial-token",
    args: ["pr", "list", "--repo", "acme/project"],
  });
  const child = Bun.spawn(["git", "credential", "fill"], {
    cwd: f.home,
    env: f.env,
    stdin: new Blob(["protocol=https\nhost=github.com\n\n"]),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await new Response(child.stdout).text()).toContain("password=initial-token");
  expect(await child.exited).toBe(0);
  expect(readFileSync(join(f.home, ".profile"), "utf8")).not.toContain("initial-token");
  expect(readFileSync(join(f.home, ".gitconfig"), "utf8")).not.toContain("initial-token");
  expect(readFileSync(join(f.home, ".gitconfig"), "utf8")).not.toContain(
    "/run/gitterm/git-credential-helper.sh",
  );
  expect(readFileSync(join(f.home, ".gitconfig"), "utf8")).toContain("user-owned-helper");
  expect(statSync(join(f.home, ".gitterm/github/config.json")).mode & 0o777).toBe(0o600);
  expect(statSync(join(f.home, ".gitterm/github")).mode & 0o777).toBe(0o700);
  expect((await f.run(["setup"])).code).toBe(0);
  expect(readFileSync(join(f.home, ".profile"), "utf8").match(/gitterm-github-cli/g)).toHaveLength(
    1,
  );
});

test("installation tokens refresh once across concurrent CLI and Git processes", async () => {
  const f = fixture(true, new Date(0).toISOString());
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests++;
      expect(new URL(request.url).pathname).toBe("/workspaceOps.gitCredential");
      expect(request.headers.get("authorization")).toBe("Bearer workspace-jwt");
      await Bun.sleep(100);
      return Response.json({
        result: {
          data: {
            json: {
              token: "refreshed-token",
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            },
          },
        },
      });
    },
  });
  servers.push(server);
  f.env.WORKSPACE_API_URL = server.url.toString();
  f.env.WORKSPACE_AUTH_TOKEN = "workspace-jwt";
  await f.run(["setup"]);
  f.install();
  const results = await Promise.all([
    f.run(["gh", "pr", "list"]),
    f.run(["gh", "issue", "list"]),
    f.run(["credential", "get"], "protocol=https\nhost=github.com\n\n"),
  ]);
  for (const result of results) {
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("refreshed-token");
  }
  expect(requests).toBe(1);
  expect((await f.run(["gh", "pr", "list"])).stdout).toContain("refreshed-token");
  expect(requests).toBe(1);
  expect(statSync(join(f.home, ".gitterm/github/cache.json")).mode & 0o777).toBe(0o600);
});

test("fresh installation token needs no refresh endpoint", async () => {
  const f = fixture(true, new Date(Date.now() + 3600000).toISOString());
  await f.run(["setup"]);
  f.install();
  expect((await f.run(["gh", "pr", "list"])).stdout).toContain("initial-token");
});

test("failed refresh fails closed without invoking gh or printing credentials", async () => {
  const f = fixture(true);
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("secret-upstream-error", { status: 403 });
    },
  });
  servers.push(server);
  f.env.WORKSPACE_API_URL = server.url.toString();
  f.env.WORKSPACE_AUTH_TOKEN = "workspace-secret";
  await f.run(["setup"]);
  f.install();
  const result = await f.run(["gh", "pr", "list"]);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("authentication failed");
  expect(result.stderr).not.toMatch(/initial-token|workspace-secret|secret-upstream-error/);
  expect((await f.run(["gh", "--version"])).code).toBe(0);
});

test("CLI installed later is discovered and its exit status and arguments are preserved", async () => {
  const f = fixture();
  await f.run(["setup"]);
  expect((await f.run(["gh", "--version"], "", { PATH: join(f.home, ".gitterm/bin") })).code).toBe(
    127,
  );
  f.install();
  const result = await f.run(["gh", "pr", "create", "--title", "spaces ' and $symbols"], "", {
    FAKE_GH_EXIT: "7",
  });
  expect(result.code).toBe(7);
  expect(JSON.parse(result.stdout).args.at(-1)).toBe("spaces ' and $symbols");
});

test("explicit gh credentials are respected and managed credentials stay on github.com", async () => {
  const f = fixture();
  await f.run(["setup"]);
  f.install();
  expect(
    JSON.parse((await f.run(["gh", "pr", "list"], "", { GH_TOKEN: "explicit-token" })).stdout)
      .token,
  ).toBe("explicit-token");
  for (const args of [
    ["api", "--hostname", "other.ghe.com", "/user"],
    ["pr", "list", "-R", "other.ghe.com/acme/project"],
  ]) {
    expect(JSON.parse((await f.run(["gh", ...args])).stdout).token).toBe("");
  }
  expect(
    JSON.parse((await f.run(["gh", "pr", "list"], "", { GH_HOST: "other.ghe.com" })).stdout).token,
  ).toBe("");
  expect((await f.run(["credential", "get"], "protocol=https\nhost=example.com\n\n")).stdout).toBe(
    "",
  );
  expect((await f.run(["credential", "get"], "protocol=http\nhost=github.com\n\n")).stdout).toBe(
    "",
  );
  expect(
    (await f.run(["credential", "store"], "protocol=https\nhost=github.com\npassword=bad\n\n"))
      .stdout,
  ).toBe("");
});

test("no token or a non-GitHub repo does not provision managed CLI authentication", () => {
  expect(githubAuthProvisioning()).toBeUndefined();
  expect(githubAuthProvisioning({ url: "https://github.com/acme/project" })).toBeUndefined();
  expect(
    githubAuthProvisioning({ url: "https://gitlab.com/acme/project", authToken: "token" }),
  ).toBeUndefined();
});

test("launch command composes with exec and preserves shell quoting", async () => {
  const f = fixture();
  const child = Bun.spawn(["sh", "-c", `exec ${githubAuthCommand("printf '%s' \"$PATH\"")}`], {
    env: f.env,
    stdout: "pipe",
  });
  expect(await new Response(child.stdout).text()).toStartWith(`${f.home}/.gitterm/bin:`);
  expect(await child.exited).toBe(0);
});
