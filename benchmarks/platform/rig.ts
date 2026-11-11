#!/usr/bin/env bun
/**
 * Starts and stops the local platform benchmark rig:
 *
 *   Postgres + Redis (Docker, tmpfs)  <-  real API server(s)  <-  Caddy with the production
 *   Caddyfile  ->  mock workspace upstreams
 *
 *   bun benchmarks/platform/rig.ts up [--workspaces 100000] [--scenario 200] [--upstreams 50]
 *                                     [--tls-upstreams 50] [--caddyfile <path>]
 *   bun benchmarks/platform/rig.ts restart-server   # after editing API code
 *   bun benchmarks/platform/rig.ts restart-caddy [--caddyfile <path>]
 *   bun benchmarks/platform/rig.ts status
 *   bun benchmarks/platform/rig.ts down             # stops everything, removes containers and state
 */
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASE_DOMAIN,
  BENCH_USER,
  DATABASE_URL,
  INTERNAL_API_KEY,
  PLATFORM_DIR,
  PORTS,
  REPO_ROOT,
  STATE_DIR,
  STATE_MARKER,
  ensureDirs,
  saveState,
  serverEnv,
} from "./lib/config";
import { seed } from "./lib/seed";

const [command = "status", ...rest] = process.argv.slice(2);
if (["--help", "-h", "help"].includes(command)) {
  console.log(`Usage: bun benchmarks/platform/rig.ts <command>

Commands: up, status, restart-server, restart-caddy, down
up: --workspaces 100000 --scenario 200 --upstreams 50 --tls-upstreams 50 --caddyfile <path>
restart-caddy: --caddyfile <path>
down: --keep-results

Uses disposable local Postgres and Redis containers. See benchmarks/platform/README.md.`);
  process.exit(0);
}
const flag = (name: string, fallback: string) => {
  const index = rest.indexOf(`--${name}`);
  return index === -1 ? fallback : rest[index + 1]!;
};
const number = (name: string, fallback: number) => Number(flag(name, String(fallback)));

const pidFile = (name: string) => join(STATE_DIR, `${name}.pid`);

function run(cmd: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  const result = Bun.spawnSync(cmd, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.toString();
}

/** Detached, with only the env given, from a cwd that has no .env files. */
function start(name: string, cmd: string[], env: Record<string, string>) {
  const cwd = join(STATE_DIR, "cwd");
  mkdirSync(cwd, { recursive: true });
  const log = openSync(join(STATE_DIR, `${name}.log`), "w");
  const child = Bun.spawn(cmd, { cwd, env, stdout: log, stderr: log, stdin: "ignore" });
  child.unref();
  writeFileSync(pidFile(name), String(child.pid));
}

function stop(name: string) {
  const path = pidFile(name);
  if (!existsSync(path)) return;
  const pid = Number(readFileSync(path, "utf8"));
  // A pid file can outlive its process (a reboot); only stop what the rig started.
  const command = Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)]).stdout.toString();
  if (/caddy run|benchmarks\/platform\/upstream|apps\/server\/src\/index/.test(command)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  rmSync(path, { force: true });
}

async function waitFor(url: string, label: string, headers: Record<string, string> = {}) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {}
    await Bun.sleep(200);
  }
  throw new Error(`${label} did not answer at ${url}; see ${STATE_DIR}/*.log`);
}

async function startServer() {
  stop("server-0");
  start(
    "server-0",
    ["bun", "run", join(REPO_ROOT, "apps/server/src/index.ts")],
    serverEnv(PORTS.server),
  );
  await waitFor(`http://127.0.0.1:${PORTS.server}/api/health`, "server");
}

/**
 * The managed production Caddyfile with only what a local run needs changed:
 * the listen port, the error page root, and (upstreams here use a self-signed
 * certificate) certificate verification on the workspace transport.
 */
function renderCaddyfile(source: string) {
  const out = readFileSync(source, "utf8")
    .replace("auto_https off", `auto_https off\n\thttp_port ${PORTS.caddy}`)
    .replaceAll(":80 {", `:${PORTS.caddy} {`)
    .replaceAll("/srv/errors", join(REPO_ROOT, "apps/proxy/errors"))
    .replaceAll(/^(\s*)tls$/gm, "$1tls\n$1tls_insecure_skip_verify");
  const path = join(STATE_DIR, "Caddyfile");
  writeFileSync(path, out);
  return path;
}

async function startCaddy(source: string) {
  stop("caddy");
  const config = renderCaddyfile(source);
  start("caddy", ["caddy", "run", "--config", config, "--adapter", "caddyfile"], {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    SERVER_URL: `127.0.0.1:${PORTS.server}`,
    INTERNAL_API_KEY,
    BASE_DOMAIN,
    ROUTING_MODE: "subdomain",
  });
  await waitFor(`http://127.0.0.1:${PORTS.caddy}/health`, "caddy");
}

async function signIn(): Promise<{ cookie: string; userId: string }> {
  const origin = `http://${BASE_DOMAIN}`;
  const base = `http://127.0.0.1:${PORTS.server}/api/auth`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });
  let response = await post("/sign-up/email", BENCH_USER);
  if (!response.ok) {
    response = await post("/sign-in/email", {
      email: BENCH_USER.email,
      password: BENCH_USER.password,
    });
  }
  if (!response.ok) throw new Error(`sign-in failed: ${response.status} ${await response.text()}`);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0]!;
  const body = (await response.json()) as { user: { id: string } };
  if (!cookie.includes("session_token")) throw new Error("no session cookie in sign-in response");
  return { cookie, userId: body.user.id };
}

async function up() {
  ensureDirs();
  const workspaces = number("workspaces", 100_000);
  const scenario = number("scenario", 200);
  const upstreams = number("upstreams", 50);
  const tlsUpstreams = number("tls-upstreams", 50);
  for (const tool of ["docker", "caddy"]) {
    if (!Bun.which(tool)) throw new Error(`${tool} is not on the PATH`);
  }

  console.log("postgres + redis ...");
  run(["docker", "compose", "up", "-d", "--wait"], { cwd: PLATFORM_DIR });

  console.log("migrate + seed catalog ...");
  const dbEnv = { DATABASE_URL };
  run(["bun", "run", "src/migrate-cli.ts", "--prod"], {
    cwd: join(REPO_ROOT, "packages/db"),
    env: dbEnv,
  });
  run(["bun", "run", "src/seed-cli.ts", "--prod"], {
    cwd: join(REPO_ROOT, "packages/db"),
    env: dbEnv,
  });

  console.log("api server ...");
  await startServer();
  const { cookie, userId } = await signIn();

  console.log(`seed ${workspaces} workspaces + ${scenario} per scenario ...`);
  const subdomains = await seed({ workspaces, scenario, upstreams, tlsUpstreams, userId });

  console.log("mock upstreams ...");
  stop("upstream");
  start(
    "upstream",
    [
      "bun",
      "run",
      join(PLATFORM_DIR, "upstream.ts"),
      "--count",
      String(upstreams),
      "--tls-count",
      String(tlsUpstreams),
    ],
    { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", GITTERM_BENCH_STATE: STATE_DIR },
  );
  await waitFor(`http://127.0.0.1:${PORTS.upstream}/ping`, "upstream");

  console.log("caddy ...");
  await startCaddy(flag("caddyfile", join(REPO_ROOT, "apps/proxy/Caddyfile")));

  saveState({
    cookie,
    userId,
    upstreams,
    tlsUpstreams,
    workspaces,
    subdomains,
  });
  console.log(`rig is up. state and logs: ${STATE_DIR}`);
}

async function down() {
  for (const name of ["caddy", "upstream", "server-0"]) stop(name);
  try {
    run(["docker", "compose", "down", "--volumes", "--remove-orphans"], { cwd: PLATFORM_DIR });
  } catch (error) {
    console.warn(String(error));
  }
  if (!rest.includes("--keep-results") && existsSync(join(STATE_DIR, STATE_MARKER))) {
    rmSync(STATE_DIR, { recursive: true, force: true });
  }
  console.log("rig is down");
}

async function status() {
  const check = async (label: string, url: string) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      console.log(`${label.padEnd(10)} ${response.status}`);
    } catch {
      console.log(`${label.padEnd(10)} down`);
    }
  };
  await check("server", `http://127.0.0.1:${PORTS.server}/api/health`);
  await check("caddy", `http://127.0.0.1:${PORTS.caddy}/health`);
  await check("upstream", `http://127.0.0.1:${PORTS.upstream}/ping`);
  console.log(
    run(["docker", "compose", "ps", "--format", "{{.Service}} {{.Status}}"], { cwd: PLATFORM_DIR }),
  );
}

switch (command) {
  case "up":
    await up();
    break;
  case "down":
    await down();
    break;
  case "restart-server":
    await startServer();
    console.log("server restarted");
    break;
  case "restart-caddy":
    await startCaddy(flag("caddyfile", join(REPO_ROOT, "apps/proxy/Caddyfile")));
    console.log("caddy restarted");
    break;
  case "status":
    await status();
    break;
  default:
    console.error(`unknown command: ${command}`);
    process.exit(1);
}
