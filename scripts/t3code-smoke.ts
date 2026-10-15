/** Opt-in upstream CLI compatibility check. No model requests or provider accounts. */
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { T3_PAIRING_CREATE_COMMAND } from "../packages/api/src/service/agents/t3code";

const binary = process.env.T3_SMOKE_BINARY;
if (!binary) throw new Error("Set T3_SMOKE_BINARY to a locally installed t3 executable");
if (process.platform === "win32")
  throw new Error("This process-group smoke check requires Linux or macOS");
const executable = resolve(binary);
const root = mkdtempSync(join(process.env.T3_SMOKE_ROOT ?? tmpdir(), "gitterm-t3-smoke-"));
const repo = join(root, "repo");
mkdirSync(repo);
const env = {
  // Do not inherit real model keys, config overrides, or workspace credentials.
  TMPDIR: process.env.TMPDIR ?? tmpdir(),
  LANG: process.env.LANG ?? "en_US.UTF-8",
  HOME: root,
  T3CODE_HOME: join(root, ".t3code"),
  XDG_CONFIG_HOME: join(root, ".config"),
  XDG_DATA_HOME: join(root, ".local/share"),
  XDG_STATE_HOME: join(root, ".local/state"),
  XDG_CACHE_HOME: join(root, ".cache"),
  PATH: `${dirname(executable)}:${process.env.PATH}`,
};
const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
const port = reservation.port!;
reservation.stop(true);
const url = `http://127.0.0.1:${port}`;
let server: ChildProcess | undefined;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function start() {
  server = spawn(
    executable,
    [
      "start",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--no-browser",
      "--auto-bootstrap-project-from-cwd",
    ],
    { cwd: repo, env, stdio: "ignore", detached: true },
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}/.well-known/t3/environment`, {
      signal: AbortSignal.timeout(2_000),
    }).catch(() => null);
    if (response?.ok) return;
    if (server.exitCode !== null) throw new Error("T3 exited before readiness");
    await Bun.sleep(250);
  }
  throw new Error("T3 readiness timed out");
}

async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, "exit");
  // npm's t3 launcher uses spawnSync. Kill the entire test-owned process group,
  // not just that launcher, so the native server really stops before restart.
  process.kill(-server.pid!, "SIGKILL");
  await exited;
}

async function mint() {
  const process = Bun.spawn(["sh", "-c", T3_PAIRING_CREATE_COMMAND], {
    cwd: repo,
    env,
    stdout: "pipe",
    stderr: "ignore",
  });
  const token = (await new Response(process.stdout).text()).trim();
  check((await process.exited) === 0 && token, "Pairing command did not produce a credential");
  return token;
}

async function pair(token: string) {
  return fetch(`${url}/api/auth/browser-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://app.t3.codes" },
    body: JSON.stringify({ credential: token }),
    signal: AbortSignal.timeout(10_000),
  });
}

async function verifyProject(cookie: string) {
  const response = await fetch(`${url}/api/orchestration/snapshot`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(10_000),
  });
  check(response.ok, "Authenticated snapshot failed");
  const snapshot = (await response.json()) as { projects: Array<{ workspaceRoot: string }> };
  check(
    snapshot.projects.filter((project) => project.workspaceRoot === repo).length === 1,
    "Startup did not register exactly one project",
  );
}

try {
  await start();
  console.log("T3 smoke: server ready");
  const token = await mint();
  console.log("T3 smoke: credential issued");
  const response = await pair(token);
  check(response.ok, "Hosted-app pairing failed");
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  check(cookie, "Pairing did not issue a browser session");
  check(!(await pair(token)).ok, "A one-time pairing token was reusable");
  await verifyProject(cookie);
  console.log("T3 smoke: pairing and project verified");
  const nextToken = await mint();
  check(nextToken !== token, "Fresh pairing token was not unique");
  await stop();
  const stopped = await fetch(`${url}/.well-known/t3/environment`, {
    signal: AbortSignal.timeout(2_000),
  }).catch(() => null);
  check(!stopped, "Native T3 server survived shutdown; restart was not isolated");
  await start();
  await verifyProject(cookie);
  check((await pair(nextToken)).ok, "Unused pairing grant did not survive restart");
  console.log(
    "T3 smoke passed: discovery, hosted-app pairing, one-time tokens, project registration, restart persistence",
  );
} finally {
  await stop();
  rmSync(root, { recursive: true, force: true });
}
