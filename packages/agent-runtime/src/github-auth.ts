/** Shared by managed provisioning and the standalone SDK; no provider dependencies. */
export const GITHUB_AUTH_PATH = 'export PATH="$HOME/.gitterm/bin:$PATH"';

export const GITHUB_CLI_INSTRUCTIONS = `The user may have provided GitHub credentials or connected a GitHub integration for this workspace. When provided, GitTerm makes that authentication available to Git and the GitHub CLI (gh); use gh directly with the existing authentication.
Do not assume credentials are present or have permission for every operation. Try the repository operation needed for the task; if authentication or permissions are unavailable, explain what access is needed to the user.
The image may or may not include gh. If you need it for the task, check gh --version and install the official CLI if it is missing, using the image's package manager or a user-local binary directory on PATH.
Keep ~/.gitterm/bin on PATH and install the actual CLI outside that directory when GitTerm's authentication launcher is present. The launcher uses the supplied credentials and renews integration tokens, so there is no need to copy tokens or run gh auth login for that authentication.`;

/** Remains a single executable command when a provider prefixes it with exec/nohup. */
export function githubAuthCommand(command: string): string {
  return `env PATH="$HOME/.gitterm/bin:$PATH" sh -c '${command.replaceAll("'", `'"'"'`)}'`;
}

export interface GithubAuthRepository {
  url: string;
  authToken?: string;
  authUsername?: string;
  inlineAuth?: boolean;
  authExpiresAt?: string;
}

export function hasGithubAuth(
  repo?: GithubAuthRepository,
): repo is GithubAuthRepository & { authToken: string } {
  return Boolean(
    repo?.authToken &&
    /^(https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/i.test(repo.url),
  );
}

export function githubAuthProvisioning(repo?: GithubAuthRepository) {
  if (!hasGithubAuth(repo)) {
    return undefined;
  }
  const config = {
    token: repo.authToken,
    username: repo.authUsername ?? "x-access-token",
    renewable: !repo.inlineAuth,
    expiresAt: repo.authExpiresAt,
  };
  return {
    files: [
      {
        path: "~/.gitterm/github/runtime.cjs",
        contentBase64: Buffer.from(GITHUB_AUTH_RUNTIME).toString("base64"),
        mode: 0o600 as const,
      },
      {
        path: "~/.gitterm/github/config.json",
        contentBase64: Buffer.from(JSON.stringify(config)).toString("base64"),
        mode: 0o600 as const,
      },
    ],
    setup: `node "$HOME/.gitterm/github/runtime.cjs" setup || exit $?\n${GITHUB_AUTH_PATH}`,
  };
}

// Plain Node source is transported with the existing agent-file manifest. Keeping it
// here makes SDK bundles self-contained and avoids a second runtime package/install.
export const GITHUB_AUTH_RUNTIME = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const { randomUUID } = require("node:crypto");
const directory = path.join(os.homedir(), ".gitterm/github");
const bin = path.join(os.homedir(), ".gitterm/bin");
const configFile = path.join(directory, "config.json");
const cacheFile = path.join(directory, "cache.json");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const valid = (value) => typeof value === "string" && value.length > 0 && !/[\r\n\0]/.test(value);
const fresh = (value) => valid(value?.token) && Date.parse(value.expiresAt) > Date.now() + 300000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function atomicWrite(file, value) {
  const temporary = file + "." + randomUUID();
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

async function credential() {
  const config = read(configFile);
  if (!config.renewable) {
    if (!valid(config.token) || !valid(config.username)) throw new Error("invalid credential");
    return config;
  }
  const cached = () => {
    try { const value = read(cacheFile); if (fresh(value)) return value; } catch {}
    if (fresh(config)) return config;
  };
  let value = cached();
  if (value) return value;
  const lock = path.join(directory, "refresh.lock");
  const deadline = Date.now() + 15000;
  while (true) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.rmdirSync(lock);
      } catch {}
      if (Date.now() > deadline) throw new Error("refresh busy");
      await delay(100);
      value = cached();
      if (value) return value;
    }
  }
  try {
    value = cached();
    if (value) return value;
    const url = process.env.WORKSPACE_API_URL;
    const auth = process.env.WORKSPACE_AUTH_TOKEN;
    if (!url || !auth) throw new Error("refresh unavailable");
    const response = await fetch(url.replace(/\/$/, "") + "/workspaceOps.gitCredential", {
      method: "POST",
      headers: { Authorization: "Bearer " + auth, "Content-Type": "application/json" },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("refresh failed");
    const body = await response.json();
    const data = body.result?.data?.json ?? body.result?.data;
    if (!fresh(data)) throw new Error("invalid credential");
    value = { token: data.token, expiresAt: data.expiresAt, username: "x-access-token" };
    atomicWrite(cacheFile, value);
    return value;
  } finally { fs.rmdirSync(lock); }
}

function setup() {
  fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  fs.chmodSync(configFile, 0o600);
  for (const [name, mode] of [["gh", "gh"], ["git-credential-gitterm", "credential"]]) {
    const file = path.join(bin, name);
    fs.writeFileSync(file, '#!/bin/sh\nexec node "$HOME/.gitterm/github/runtime.cjs" ' + mode + ' "$@"\n', { mode: 0o700 });
    fs.chmodSync(file, 0o700);
  }
  // Reset only GitHub's helper chain. Other hosts retain their own credentials.
  // Retire our clone-time helpers, which predate host-scoped runtime auth.
  let helpers = [];
  try { helpers = cp.execFileSync("git", ["config", "--global", "--get-all", "credential.helper"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n"); } catch {}
  for (const helper of helpers) {
    if (["/usr/local/bin/gitterm-git-credential", "/run/gitterm/git-credential-helper.sh", "/tmp/gitterm-repository-auth/git-credential-helper.sh", "/workspace/.git-credential-helper.sh"].includes(helper) || helper.includes('password=$GITHUB_APP_TOKEN')) {
      cp.execFileSync("git", ["config", "--global", "--fixed-value", "--unset-all", "credential.helper", helper]);
    }
  }
  const key = "credential.https://github.com.helper";
  cp.execFileSync("git", ["config", "--global", "--replace-all", key, ""]);
  cp.execFileSync("git", ["config", "--global", "--add", key, '!node "$HOME/.gitterm/github/runtime.cjs" credential']);
  // Login shells and interactive agent shells may reset PATH. No secrets in profiles.
  const line = 'export PATH="$HOME/.gitterm/bin:$PATH" # gitterm-github-cli';
  for (const name of [".profile", ".bashrc", ".zshrc"]) {
    const file = path.join(os.homedir(), name);
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (!text.includes(line)) fs.appendFileSync(file, "\n" + line + "\n", { mode: 0o600 });
  }
}

function githubTarget(args) {
  let host = process.env.GH_HOST;
  let repo = process.env.GH_REPO;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--hostname") host = args[++i];
    else if (args[i].startsWith("--hostname=")) host = args[i].slice(11);
    else if (args[i] === "--repo" || args[i] === "-R") repo = args[++i];
    else if (args[i].startsWith("--repo=")) repo = args[i].slice(7);
    else if (args[i].startsWith("-R") && args[i].length > 2) repo = args[i].slice(2);
  }
  if (host && host.toLowerCase() !== "github.com") return false;
  if (repo && !/^(https:\/\/github\.com\/|github\.com\/)?[^/]+\/[^/]+\/?$/.test(repo)) return false;
  if (args.some((arg) => /^https?:\/\//.test(arg) && !/^https:\/\/(api\.)?github\.com\//.test(arg))) return false;
  if (!host && !repo) {
    try {
      const origin = cp.execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (!/^(https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/i.test(origin)) return false;
    } catch {}
  }
  return true;
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "setup") return setup();
  if (mode === "credential") {
    if (args[0] !== "get") return;
    const input = fs.readFileSync(0, "utf8");
    const fields = Object.fromEntries(input.trim().split("\n").map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
    if (fields.protocol !== "https" || fields.host !== "github.com") return;
    const value = await credential();
    process.stdout.write("username=" + (value.username ?? "x-access-token") + "\npassword=" + value.token + "\n");
    return;
  }
  if (mode !== "gh") throw new Error("invalid mode");
  // Find the actual binary on every invocation, including installations made later.
  const wrapper = fs.realpathSync(path.join(bin, "gh"));
  let executable;
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.resolve(entry, "gh");
    try {
      if (fs.statSync(candidate).isFile() && fs.realpathSync(candidate) !== wrapper) {
        fs.accessSync(candidate, fs.constants.X_OK); executable = candidate; break;
      }
    } catch {}
  }
  if (!executable) {
    console.error("GitHub CLI is not installed in this image. Install gh, then retry.");
    process.exitCode = 127;
    return;
  }
  const env = { ...process.env };
  if (!env.GH_TOKEN && !env.GITHUB_TOKEN && args.length && githubTarget(args) && !args.some((arg) => ["--help", "--version"].includes(arg)) && args[0] !== "help") {
    env.GH_TOKEN = (await credential()).token;
  }
  const child = cp.spawn(executable, args, { env, stdio: "inherit" });
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => child.kill(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  child.on("error", () => { console.error("Could not start GitHub CLI."); process.exitCode = 127; });
  child.on("exit", (code, signal) => {
    for (const [name, handler] of handlers) process.removeListener(name, handler);
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}
main().catch(() => {
  console.error("GitTerm GitHub authentication failed; check the workspace credentials or integration.");
  process.exitCode = 1;
});
`;
