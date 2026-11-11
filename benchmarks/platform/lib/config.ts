import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../../..");
export const PLATFORM_DIR = resolve(import.meta.dir, "..");

/** Logs, pid files and the generated Caddyfile. Outside the repo so nothing is left behind. */
export const STATE_DIR = process.env.GITTERM_BENCH_STATE ?? join(tmpdir(), "gitterm-bench");
export const RESULTS_DIR = process.env.GITTERM_BENCH_RESULTS ?? join(STATE_DIR, "results");

export const PORTS = {
  postgres: 5439,
  redis: 6380,
  /** API server replicas listen on server, server + 1, ... */
  server: 3100,
  caddy: 8899,
  /** Plain HTTP mock workspaces listen on upstream .. upstream + count - 1. */
  upstream: 4500,
  /** TLS mock workspaces listen on upstreamTls .. upstreamTls + count - 1. */
  upstreamTls: 4800,
} as const;

export const BASE_DOMAIN = "gitterm.test";
export const INTERNAL_API_KEY = "bench-internal-key";
export const DATABASE_URL = `postgres://postgres:bench@127.0.0.1:${PORTS.postgres}/gitterm`;
export const REDIS_URL = `redis://127.0.0.1:${PORTS.redis}`;
export const SERVER_URL = `http://127.0.0.1:${PORTS.server}`;
export const CADDY_URL = `http://127.0.0.1:${PORTS.caddy}`;

export const BENCH_USER = {
  email: "bench@gitterm.test",
  password: "bench-password-123",
  name: "Bench",
};

/**
 * The server gets exactly this environment (spawned with a clean env from a cwd
 * that has no .env files), so it can never pick up a real database or provider key.
 */
export function serverEnv(port: number): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NODE_ENV: "production",
    PORT: String(port),
    DEPLOYMENT_MODE: "self-hosted",
    BASE_DOMAIN,
    ROUTING_MODE: "subdomain",
    INTERNAL_API_KEY,
    BETTER_AUTH_SECRET: "bench-secret-bench-secret-bench-secret-1234",
    BETTER_AUTH_URL: `http://${BASE_DOMAIN}`,
    DATABASE_URL,
    REDIS_URL,
    ENCRYPTION_MASTER_KEY: "0123456789abcdef".repeat(4),
    WORKSPACE_JWT_SECRET: "bench-jwt-secret-bench-jwt-secret",
    ENABLE_IDLE_REAPING: "false",
  };
}

export type RigState = {
  cookie: string;
  userId: string;
  upstreams: number;
  tlsUpstreams: number;
  workspaces: number;
  /** Scenario subdomains seeded for the benches. */
  subdomains: {
    private: string[];
    privateTls: string[];
    serverOnly: string[];
    publicPort: string[];
  };
};

const statePath = () => join(STATE_DIR, "state.json");

/** Marks a directory as the rig's own, so `rig.ts down` never deletes anything else. */
export const STATE_MARKER = ".gitterm-bench";

export function ensureDirs() {
  if (
    existsSync(STATE_DIR) &&
    !existsSync(join(STATE_DIR, STATE_MARKER)) &&
    readdirSync(STATE_DIR).length > 0
  ) {
    throw new Error(`Refusing to use a nonempty, unmarked state directory: ${STATE_DIR}`);
  }
  mkdirSync(STATE_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(STATE_DIR, STATE_MARKER), "");
}

export function saveState(state: RigState) {
  ensureDirs();
  writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

export function loadState(): RigState {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as RigState;
  } catch {
    throw new Error(`No rig state at ${statePath()}. Run: bun benchmarks/platform/rig.ts up`);
  }
}

export function saveResult(name: string, data: unknown) {
  ensureDirs();
  if (!/^[a-zA-Z0-9_-]+$/.test(name))
    throw new Error("Result names may contain letters, numbers, underscores and hyphens only.");
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const path = join(RESULTS_DIR, `${name}-${timestamp}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2), { flag: "wx" });
  return path;
}

export const workspaceHost = (subdomain: string, port?: number) =>
  `${port ? `${port}-` : ""}${subdomain}.${BASE_DOMAIN}`;
