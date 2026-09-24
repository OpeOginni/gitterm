/**
 * Shared helpers for the CLI scripts that prepare a database before the
 * server starts (migrate, seed). Not imported by the server itself.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { Pool, type PoolClient } from "pg";

export type BootstrapTarget = "dev" | "prod";

/**
 * Single advisory lock key shared by every bootstrap step so that concurrent
 * replicas starting at the same time serialize their schema/seed work.
 * Arbitrary constant; must stay stable across releases.
 */
export const BOOTSTRAP_LOCK_KEY = 7_204_913_261;

/**
 * Resolve the target from argv and load DATABASE_URL the same way for every
 * bootstrap script:
 *   - prod: prefer the runtime environment (Docker/CI), fall back to apps/server/.env
 *   - dev:  always bind to apps/server/.env.development.local when present
 */
export function loadDatabaseUrl(scriptName: string): { target: BootstrapTarget; url: string } {
  const isProd = process.argv.includes("--prod");
  const target: BootstrapTarget = isProd ? "prod" : "dev";
  const envFile = isProd ? ".env" : ".env.development.local";
  const envPath = resolve(import.meta.dir, "../../../apps/server", envFile);

  if (isProd) {
    if (!process.env.DATABASE_URL && existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  } else if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      `[${scriptName}] DATABASE_URL is required for ${target}. Expected it in ${envPath} or the environment.`,
    );
    process.exit(1);
  }

  console.log(`[${scriptName}] target=${target}`);
  console.log(`[${scriptName}] database=${maskDatabaseUrl(url)}`);
  return { target, url };
}

export function maskDatabaseUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Poll the database until it accepts connections. Containers routinely start
 * before Postgres is ready to serve, so we retry instead of crash-looping.
 *
 * Tunable via DB_WAIT_TIMEOUT_MS (default 60s) and DB_WAIT_INTERVAL_MS (default 2s).
 */
export async function waitForDatabase(pool: Pool, scriptName: string): Promise<void> {
  const timeoutMs = readIntEnv("DB_WAIT_TIMEOUT_MS", 60_000);
  const intervalMs = readIntEnv("DB_WAIT_INTERVAL_MS", 2_000);
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastError: unknown;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
      } finally {
        client.release();
      }
      if (attempt > 1) console.log(`[${scriptName}] Database reachable after ${attempt} attempts`);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.log(
        `[${scriptName}] Database not ready (attempt ${attempt}): ${message}. Retrying in ${intervalMs}ms...`,
      );
      await new Promise((resolveSleep) => setTimeout(resolveSleep, intervalMs));
    }
  }

  console.error(`[${scriptName}] Gave up waiting for database after ${timeoutMs}ms`);
  if (lastError) console.error(lastError);
  process.exit(1);
}

/**
 * Run `fn` while holding a session-level advisory lock on a dedicated client.
 * Blocks until the lock is available so a second replica simply waits for the
 * first to finish rather than racing it.
 */
export async function withBootstrapLock<T>(
  pool: Pool,
  scriptName: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    console.log(`[${scriptName}] Acquiring bootstrap lock...`);
    await client.query("SELECT pg_advisory_lock($1)", [BOOTSTRAP_LOCK_KEY]);
    console.log(`[${scriptName}] Lock acquired`);
    try {
      return await fn(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [BOOTSTRAP_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export function createBootstrapPool(url: string): Pool {
  return new Pool({ connectionString: url, max: 2 });
}
